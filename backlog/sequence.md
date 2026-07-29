# Backlog Sequence

_Last sequenced: 2026-07-29T16:37:11.469Z · model: claude-fable-5 · open: 750_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 1 | PAN-3264 | M | critical | ok |  |  | In pipeline: merged, blocks-main, needs close-out — pinned at top until close-out lands. |
| 3 | PAN-3232 | M | high | ok |  |  | Pending-input render layer drops data the store has: dead issue-view triangle, prompt text nowhere, stale tree, invisible specialists |
| 6 | PAN-3242 | M | high | ok |  |  | Rebuild order-book RunSettingsPanel to the approved mockup: atomic posture+reason, visible attribution, per-field save state |
| 6 | PAN-3260 | M | medium | ok |  |  | In pipeline: markdown chip editor in review — pinned; blocked by a test agent that never ran (PAN-3274). |
| 7 | PAN-3285 | L | critical | ok |  |  | Supervisor pinned to a reload generation kills every healthy dashboard — 3.5h outage, 1107 silent failures, no operator escalation. |
| 8 | PAN-3283 | M | critical | ok |  |  | Recovery from review_infrastructure_failure writes review_status=passed over an outstanding CHANGES REQUESTED verdict. |
| 9 | PAN-3250 | M | critical | ok |  |  | Workspace spawn branches from local HEAD, not origin/main — every new workspace inherits unpushed local commits (blocks-main). |
| 10 | PAN-3282 | L | critical | ok |  |  | Review agents die before writing a verdict across 5 issues and 2 projects — recurring, needs manual restart each time. |
| 11 | PAN-3259 | S | critical | ok |  |  | Red main: PAN-1837 retry test races fs I/O against fake timers, flaky 1-in-5 — unblocks PAN-1837. |
| 12 | PAN-3266 | S | critical | ok |  |  | Every new workspace is born dirty from generated .husky/_/pre-rebase, blocking planning auto-handoff (blocks-main). |
| 13 | PAN-3281 | M | critical | ok |  |  | ready_for_merge stays 1 while stuck on incomplete-plan-items — stuck work reaches UAT batches and promotion. |
| 14 | PAN-3253 | M | high | ok |  |  | review.status_changed embeds the unbounded history array — one event type is 80% of a 1.3 GB overdeck.db. |
| 15 | PAN-3278 | M | critical | ok |  |  | Work agent finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none. |
| 16 | PAN-3274 | M | high | ok |  |  | A test-role agent can spawn and never run — its issue is stranded behind a verdict that was never produced. |
| 17 | PAN-2706 | M | high | ok |  |  | Ghost test sessions absorb every test dispatch — never-kicked-off session reads as running, testStatus flips with no prompt delivered. |
| 18 | PAN-3248 | S | high | ok |  |  | pan reload leaves pending-deploy.json set — every flywheel deploy starves verification for ALL projects until a patrol runs. |
| 19 | PAN-3244 | M | high | ok |  |  | Queued dashboard deploy globally defers verification — deploy window starves cross-project review handoffs unboundedly. |
| 20 | PAN-3237 | M | high | ok |  |  | Capacity-refused planning→work handoff is marked terminally stuck — every HTTP 409 becomes guardrails + markWorkspaceStuck. |
| 21 | PAN-3236 | M | high | ok |  |  | ECONNREFUSED on a dead supervisor socket misclassified as ambiguous keyed delivery — review feedback never lands, issue goes stuck. |
| 22 | PAN-3280 | M | high | needs-refinement |  |  | PAN-3253 agent sessions vanished 4x in one run and its reviewer died with no artifact — all silently. |
| 23 | PAN-3234 | M | high | ok |  |  | Agents freeze indefinitely on blocking choice menus — paneHasBlockingChoiceMenu wired to delivery refusal only, never to health. |
| 24 | PAN-3257 | M | high | ok |  |  | Crash-resume does not re-wire the PTY supervisor — stale socket refuses all deliveries and state.json loses supervisorEnabled. |
| 25 | PAN-3261 | M | high | ok |  |  | Resume-gate Enter: tmux fallback answers a live choice menu when its own paste hides the menu from the detector. |
| 26 | PAN-3224 | S | high | ok |  |  | Crash-interrupted spawn strands model=pending-work-spawn — plain pan start dies with Unknown model; only --fresh recovers. |
| 27 | PAN-3245 | S | high | ok |  |  | pan done falsely flags workspace .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion. |
| 28 | PAN-3243 | S | high | ok |  |  | auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess — flake reddened main and blocked a close-out. |
| 29 | PAN-2746 | M | high | ok |  |  | Review infra-failure bypass writes reviewStatus=passed — indistinguishable from a real approval; nearly merged unreviewed work. |
| 30 | PAN-2376 | XL | high | ok | ✓ |  | EPIC: CI/CD reliability — flakes never gate, done work always converges to merged, deploys always ship origin/main. |
| 31 | PAN-2742 | M | high | ok |  |  | Review synthesis fires 42s after spawn, calling reviewers with reports on disk an infra failure — false CHANGES REQUESTED burns cycles. |
| 32 | PAN-3106 | M | high | ok |  |  | auto_merge_default:hold is bypassed — shouldHoldForUat consulted on only one merge path, so held issues merge anyway. |
| 33 | PAN-3103 | M | high | ok |  |  | Transient merge_status=failed permanently skips automatic close-out — merged issue stays open and pickup-eligible. |
| 34 | PAN-3104 | S | high | ok |  |  | Stale .pan/test/result.json re-applied with no freshness check — re-fails an issue after the fix landed. |
| 35 | PAN-3100 | M | high | ok |  |  | Test role evaluates the dirty working tree — a live work agent's uncommitted edits produce false test failures. |
| 36 | PAN-2567 | M | high | ok |  |  | Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergence failure). |
| 37 | PAN-2569 | M | high | ok |  |  | Planning finalizes (issue→planned) but the work agent does not auto-spawn — silent handoff failure requiring manual pan start. |
| 38 | PAN-3118 | M | high | ok |  |  | Model quota exhaustion halts agents invisibly — 4 planning agents running at $0.00 with no capacity fallback or alert. |
| 39 | PAN-3139 | M | high | ok |  |  | Agents-table liveness drifts stale in the under-reporting direction — live 4h agent recorded stopped while pan start refuses. |
| 40 | PAN-3062 | M | high | ok |  |  | Shared primary main worktree: any agent that pushes main also ships every other session's unpushed local commits. |
| 41 | PAN-3081 | M | high | ok |  |  | Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted to get past a false block. |
| 42 | PAN-2940 | M | high | ok |  |  | Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface. |
| 43 | PAN-3205 | S | high | ok |  |  | Deployment gate queues a deferred deploy but never fires it — the promised next-verification-boundary trigger does not exist. |
| 44 | PAN-3085 | S | high | ok |  |  | Review feedback written to .overdeck/feedback while agents and the deacon merge gate read nonexistent .pan/feedback. |
| 45 | PAN-3078 | M | high | ok |  |  | Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever. |
| 46 | PAN-3084 | M | high | ok |  |  | A review session spawned but never briefed sits at zero context forever and blocks its own replacement. |
| 47 | PAN-2695 | M | high | ok |  |  | Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills synthesis kickoff. |
| 48 | PAN-2689 | M | high | ok |  |  | Review verdicts from sandboxed codex review agents silently lost — fire-and-forget journal write dies with the CLI process. |
| 49 | PAN-2691 | M | high | ok |  |  | Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you. |
| 50 | PAN-2650 | M | high | ok |  |  | Swarm final ready-to-merge slot wedges when the memory governor sheds the integration stack; pan swarm recover cannot recover it. |
| 51 | PAN-3286 | XL | high | ok |  | PAN-1990 | Workspace parity with Subspace: shared workspaces, target-scoped recall, status history, session briefing (PRD ready). |
| 52 | PAN-3210 | M | high | ok |  |  | Close-out blocked by an unprefixed devcontainer init-perms container — teardown scopes by compose project, guard scopes by working_dir. |
| 53 | PAN-3196 | M | high | ok |  |  | Close-out cannot tear down workspaces with root-owned container residue — passes every DoD row then dies on EACCES. |
| 54 | PAN-3188 | S | high | ok |  |  | DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row. |
| 55 | PAN-3190 | XS | high | ok |  |  | pan merge cancel is 100% broken — Commander passes its options object into the fetchImpl injection slot. |
| 56 | PAN-2075 | XL | high | ok | ✓ |  | EPIC: Boot Reconciliation + Operator Inbox — one decision surface for unverified agents, plus a durable notification spine. |
| 57 | PAN-3168 | S | medium | ok |  |  | DoD row 5 deadlocks close-out: an agent paused FOR close-out with no tmux session counts as running and blocks it. |
| 58 | PAN-3171 | M | high | ok |  |  | Pipeline reports merge failed AFTER a successful merge and cleanup — issue stays Todo while the commit is on main. |
| 59 | PAN-3186 | S | high | ok |  |  | Pipeline membership blanks the whole auricle project because one configured member (infra) is not a git repo. |
| 60 | PAN-3267 | M | high | ok |  |  | GitLab merged-head oracle fans out one glab subprocess per (repo × head), stalling and failing every membership refresh. |
| 61 | PAN-1666 | XL | high | needs-refinement | ✓ |  | EPIC: Throughput hardening — many work agents safely, on-demand rate-limited specialists, slot manager, fly.io scale-out. |
| 62 | PAN-2952 | M | high | ok |  |  | Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state. |
| 63 | PAN-3044 | M | high | ok |  |  | Review feedback delivery runs against CLOSED issues — resurrects agents and raises needs-you 12 days after close-out. |
| 64 | PAN-3043 | M | high | ok |  |  | Mid-run provider quota exhaustion undetected — agent stays running for days holding a slot (kimi 403 billing-cycle). |
| 65 | PAN-2908 | XL | high | ok |  |  | Simple-by-default, conversation-first UX overhaul — junior-dev usable with zero training; PRD + binding mockups exist. |
| 66 | PAN-3023 | M | high | ok |  |  | Post-planning auto-spawn abandoned on transient Docker failure — attempt 1/3 never retries, issue stuck in todo with no re-drive owner. |
| 67 | PAN-2758 | M | high | ok |  |  | Provider capacity error silently zombies a spawned agent — willRetry=false, turn completed, status=running forever. |
| 68 | PAN-2839 | M | high | ok |  |  | plan→work autoSpawn 500s with a duplicated workspace prep — nondeterministic half-spawns since PAN-2825. |
| 69 | PAN-2848 | M | high | ok |  |  | Work agent stalls forever on a dead inspection — no re-dispatch, verdict never delivered, swarm-off suppresses recovery. |
| 70 | PAN-2817 | M | high | ok |  |  | Idle-at-prompt work/review agents never redriven — gpt-5.6-sol sessions stop at the composer mid-task and sit for hours. |
| 71 | PAN-3057 | M | high | ok |  |  | Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice (372K vs 150K). |
| 72 | PAN-2642 | XL | high | ok | ✓ |  | EPIC: Cost strategy — waste detection over budget policing; land the progress-aware breaker, make dollars honest. |
| 73 | PAN-2759 | M | medium | ok |  |  | Dead flywheel with an active run never auto-relaunched after reboot — sat idle 2h with recovery wired and enabled. |
| 74 | PAN-2747 | M | medium | ok |  |  | Flywheel cannot be resumed after a crash/reboot — Resume disabled, only offered action aborts the run. |
| 75 | PAN-2769 | S | medium | ok |  |  | review_status rows never reconciled when an issue closes — 9 closed issues advertise reviewing/failed, inflating operator counts. |
| 76 | PAN-2888 | S | medium | ok |  |  | Close-out leaves orphaned inspect sub-agents and uncleared review_status rows on CLOSED issues, inflating troubled/failed metrics. |
| 77 | PAN-3108 | S | medium | ok |  |  | dashboard.log grows unbounded (867MB) — no rotation. |
| 78 | PAN-1824 | M | medium | ok |  |  | Fix flaky main CI: fake timers + @slow exclusion for the real-timer test family (planned, ready). |
| 79 | PAN-2670 | L | high | ok |  |  | Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors). |
| 80 | PAN-2593 | M | high | ok |  |  | Dashboard server children inherit bare system PATH — verification gates run npm/node under system Node 18, not Node 22. |
| 81 | PAN-3272 | S | medium | ok |  |  | DoD row 6 can never pass for anything merged during a red-main window, even after main goes green. |
| 82 | PAN-3202 | S | medium | ok |  |  | DoD row 6 should accept a later green main CI run containing the merge commit as main-verify evidence. |
| 83 | PAN-3167 | S | medium | ok |  |  | krux/lexerra unreadable through the membership door — GitHub App not installed, and 404 is typed forge_unavailable. |
| 84 | PAN-3256 | S | medium | ok |  |  | MYN pipeline membership fails forge_unavailable — glab mr list runs in a path that is not a git repository. |
| 85 | PAN-3047 | S | medium | ok |  |  | Strike-branch teardown never fires — --is-ancestor cannot detect a squash merge, so all 96 strike branches persist as residue. |
| 86 | PAN-3048 | S | medium | ok |  |  | Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; duplicated exclusion list has drifted. |
| 87 | PAN-3022 | S | medium | ok |  |  | Work-spawn route ignores the per-issue workModel override — role default wins and then clobbers the record. |
| 88 | PAN-2846 | S | medium | ok |  |  | Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running. |
| 89 | PAN-2059 | L | medium | ok | ✓ |  | EPIC: Backlog pickup gate — operator Plan→Release row + AI Objection state + Flywheel relevance-vetting. |
| 90 | PAN-2350 | XL | medium | ok | ✓ |  | EPIC: Overdeck Anywhere — remote access, Hermes bridge, mobile, shared relay backbone (PRD on overdeck-state). |
| 91 | PAN-2351 | L | medium | ok |  |  | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — security prerequisite for every remote surface. |
| 92 | PAN-2424 | L | medium | needs-refinement | ✓ |  | EPIC: the Order Book — operator priority queue; core landed, remaining children ranked separately. |
| 93 | PAN-3218 | M | high | ok |  |  | No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken, and nothing surface… |
| 94 | PAN-3185 | M | high | ok |  |  | pan start reports a false hard failure when the deacon wins a spawn race — duplicate-session TOCTOU between spawn.ts:498 and spawn.ts:764 |
| 95 | PAN-2995 | M | high | ok |  |  | pan done --strike false-blocks after gh-API squash-merge ('N commits missing from origin/main') — should verify PR-merged/content, not bran… |
| 96 | PAN-1560 | XS | high | ok |  |  | Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED |
| 97 | PAN-2639 | M | high | ok |  |  | codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401 |
| 98 | PAN-2521 | M | high | ok |  |  | feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled |
| 99 | PAN-2516 | M | high | ok |  |  | Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push |
| 100 | PAN-2511 | M | high | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate |
| 101 | PAN-2430 | M | high | ok |  |  | bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors |
| 102 | PAN-2421 | M | high | ok |  |  | bug(test): dashboard server route tests flake under full-suite verification load |
| 103 | PAN-2379 | M | high | ok |  |  | bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergenc… |
| 104 | PAN-2337 | M | high | ok |  |  | Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart |
| 105 | PAN-2331 | M | high | ok |  |  | bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for enter/… |
| 106 | PAN-2323 | M | high | ok |  |  | Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one |
| 107 | PAN-2324 | XS | high | ok |  |  | bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels |
| 108 | PAN-2259 | M | high | ok |  |  | bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration |
| 109 | PAN-2558 | M | high | ok |  |  | feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo) |
| 110 | PAN-2193 | M | high | ok |  |  | Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal |
| 111 | PAN-2186 | M | high | ok |  |  | bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck |
| 112 | PAN-2179 | M | high | ok |  |  | bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled) |
| 113 | PAN-2170 | M | high | ok |  |  | bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (forces --… |
| 114 | PAN-2169 | M | high | ok |  |  | bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-saturati… |
| 115 | PAN-2165 | XS | high | ok |  |  | pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF transitio… |
| 116 | PAN-2106 | M | high | ok |  |  | pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race) |
| 117 | PAN-2233 | M | high | ok |  |  | refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules |
| 118 | PAN-2190 | M | high | ok |  |  | Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split |
| 119 | PAN-1650 | M | high | ok |  |  | Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green |
| 120 | PAN-2720 | M | high | ok |  |  | File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around it in… |
| 121 | PAN-2709 | M | high | ok |  |  | Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped, feedbac… |
| 122 | PAN-1770 | M | high | ok |  |  | bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle |
| 123 | PAN-1767 | M | high | ok |  |  | Show merged-but-not-closed-out count in pan status and the dashboard headline |
| 124 | PAN-1766 | M | high | ok |  |  | bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-1616… |
| 125 | PAN-1618 | M | high | ok |  |  | Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down |
| 126 | PAN-1454 | M | high | ok |  |  | [META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues |
| 127 | PAN-1452 | M | high | ok |  |  | PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048) |
| 128 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits) |
| 129 | PAN-2358 | M | high | ok |  |  | PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) |
| 130 | PAN-2334 | M | high | ok |  |  | chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the retire… |
| 131 | PAN-2333 | M | high | ok |  |  | feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unanswer… |
| 132 | PAN-2189 | M | high | ok |  |  | Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff |
| 133 | PAN-2188 | M | high | ok |  |  | Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate |
| 134 | PAN-2080 | M | high | ok |  | PAN-2079 | Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43) |
| 135 | PAN-2079 | M | high | ok |  | PAN-2077 | Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine) |
| 136 | PAN-2078 | M | high | ok |  | PAN-2077 | CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote |
| 137 | PAN-2077 | M | high | ok |  |  | Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver |
| 138 | PAN-807 | XL | high | stale | ✓ |  | Epic C: Workspace state sanity on spawn |
| 139 | PAN-1209 | M | high | stale |  |  | PAN-1052 bead projection disagrees with bd state |
| 140 | PAN-2672 | M | medium | ok |  |  | Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id) |
| 141 | PAN-1889 | M | high | ok |  |  | feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run |
| 142 | PAN-955 | M | high | ok |  |  | Workspace devcontainer template versioning + re-render on demand |
| 143 | PAN-3284 | M | medium | ok |  |  | Work agent wrote a doc edit into the primary main worktree instead of its workspace (PAN-2204 family) |
| 144 | PAN-3276 | M | medium | ok |  |  | Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing |
| 145 | PAN-3164 | M | medium | ok |  |  | UAT stack shows 'Open UAT frontend' while still booting — operator gets Gateway Timeout with no indication it is starting |
| 146 | PAN-3157 | M | medium | ok |  |  | Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity |
| 147 | PAN-2837 | M | high | needs-refinement |  |  | Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats) |
| 148 | PAN-2830 | M | high | needs-refinement |  |  | Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs |
| 149 | PAN-3137 | M | medium | ok |  |  | UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator's UAT surface |
| 150 | PAN-3130 | M | medium | ok |  |  | Security: path-escape validation for identifier-joined write paths |
| 151 | PAN-3129 | M | medium | ok |  |  | Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths |
| 152 | PAN-3121 | M | medium | ok |  |  | Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin |
| 153 | PAN-3117 | M | medium | ok |  |  | Failed-send bubble hides deterministic 4xx reason and offers a Retry that can never succeed |
| 154 | PAN-3050 | M | medium | ok |  |  | Idle-stack reaper is blind to non-Overdeck workspaces: regex matches only overdeck-feature-*-server|frontend, so MYN stacks are never reaped |
| 155 | PAN-3046 | M | medium | ok |  |  | pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out |
| 156 | PAN-3032 | XS | medium | ok |  |  | Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-feature-' devnet — 504s; traefik devn… |
| 157 | PAN-3003 | M | medium | ok |  |  | bug(agents): work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly |
| 158 | PAN-2971 | M | medium | ok |  |  | bug(flywheel): orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause/Stop d… |
| 159 | PAN-3178 | XS | medium | ok |  |  | First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees |
| 160 | PAN-2966 | M | medium | ok |  |  | Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882) |
| 161 | PAN-2960 | M | medium | ok |  |  | Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery |
| 162 | PAN-2959 | M | medium | ok |  |  | pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882 metering-cost-… |
| 163 | PAN-2954 | XS | medium | ok |  |  | postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run |
| 164 | PAN-2935 | M | medium | ok |  |  | Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504 |
| 165 | PAN-2932 | M | medium | ok |  |  | bug(boot): intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan re… |
| 166 | PAN-2921 | M | medium | ok |  |  | Strike merge door can report fetch failure after merge and land the same head twice |
| 167 | PAN-2905 | M | medium | ok |  |  | Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner |
| 168 | PAN-2828 | M | medium | ok |  |  | pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash) |
| 169 | PAN-2824 | M | medium | ok |  |  | pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class) |
| 170 | PAN-2805 | M | medium | ok |  |  | FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere |
| 171 | PAN-2792 | M | medium | ok |  |  | Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules |
| 172 | PAN-2775 | M | medium | ok |  |  | Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z |
| 173 | PAN-2763 | M | medium | ok |  |  | Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids |
| 174 | PAN-2761 | M | medium | ok |  |  | done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like a … |
| 175 | PAN-2739 | M | medium | ok |  |  | bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nud… |
| 176 | PAN-1990 | XL | high | ok |  |  | First-class workspaces and projects with per-workspace memory |
| 176 | PAN-2738 | M | medium | ok |  |  | bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push |
| 177 | PAN-2734 | M | medium | ok |  |  | bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers |
| 178 | PAN-2733 | M | medium | ok |  |  | bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls) |
| 179 | PAN-2717 | M | medium | ok |  |  | bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse |
| 180 | PAN-2700 | M | medium | ok |  |  | Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict |
| 181 | PAN-2699 | M | medium | ok |  |  | npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace gat… |
| 182 | PAN-2697 | M | medium | ok |  |  | First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches |
| 183 | PAN-2696 | XS | medium | ok |  |  | Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label |
| 184 | PAN-2686 | XS | medium | ok |  |  | Policy strip "restart pending" badge never clears after restart-fresh with a new model (record.model is sticky) |
| 185 | PAN-1711 | M | medium | ok |  |  | Root-cause and fix dashboard event-loop stalls under load |
| 186 | PAN-1504 | M | high | ok |  |  | feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs |
| 187 | PAN-1497 | M | high | ok |  |  | feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report) |
| 188 | PAN-1451 | M | high | ok |  | PAN-1124 | PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift) |
| 189 | PAN-3090 | M | medium | ok |  |  | Simple issue page: narrative feed instead of raw transcript, surface the pending question, honest blocked state |
| 190 | PAN-3012 | M | medium | ok |  |  | Back up harness conversation transcripts before harnesses delete them |
| 191 | PAN-2664 | M | medium | ok |  |  | bug(sync-main): auto-commit completes unresolved merge with conflict markers |
| 192 | PAN-2663 | M | medium | ok |  |  | bug(restart): health probe can accept old dashboard after replacement EADDRINUSE |
| 193 | PAN-2659 | M | medium | ok |  |  | fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623) |
| 194 | PAN-2656 | M | medium | ok |  |  | bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off |
| 195 | PAN-2649 | M | medium | ok |  |  | bug(palette): Ctrl+K conversation search indexes Claude transcripts only |
| 196 | PAN-2627 | M | medium | ok |  |  | bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue t… |
| 197 | PAN-2580 | M | medium | ok |  |  | pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie |
| 198 | PAN-2563 | M | medium | ok |  |  | npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps |
| 199 | PAN-2554 | M | medium | ok |  |  | bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable |
| 200 | PAN-2550 | M | medium | ok |  |  | bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level |
| 201 | PAN-2547 | M | medium | ok |  |  | bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure |
| 202 | PAN-2546 | M | medium | ok |  |  | bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery |
| 203 | PAN-1218 | M | high | stale |  |  | Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode |
| 204 | PAN-2767 | M | medium | ok |  |  | Expose Codex app-server conversation controls in the dashboard |
| 205 | PAN-2685 | M | medium | ok |  |  | Annotated live preview: Codex-style annotate-the-app feedback delivered to agents |
| 206 | PAN-2495 | M | medium | ok |  |  | PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change |
| 207 | PAN-2478 | M | medium | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges |
| 208 | PAN-2244 | M | medium | ok |  |  | Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land) |
| 209 | PAN-2243 | M | medium | ok |  |  | pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed) |
| 210 | PAN-2242 | M | medium | ok |  |  | Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives) |
| 211 | PAN-2241 | XS | medium | ok |  |  | complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash) |
| 212 | PAN-2240 | M | medium | ok |  |  | bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy' |
| 213 | PAN-2237 | M | medium | ok |  |  | bug(cli): pan plan done swallows vbrief quality lint details |
| 214 | PAN-1776 | M | medium | ok |  |  | Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic |
| 215 | PAN-1775 | M | medium | ok |  |  | Remote (Fly.io) work agents appear as real session rows in the issue tree |
| 216 | PAN-1198 | M | high | ok |  |  | Workspace init container's bun install doesn't populate container-node-modules named volume |
| 217 | PAN-2645 | M | low | ok |  |  | Add opt-in Observation-first conversation view |
| 218 | PAN-2609 | M | low | ok |  |  | Cross-device sync of conversations and tasks via user-owned git remote |
| 219 | PAN-2582 | M | low | ok |  |  | feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes) |
| 220 | PAN-2566 | L | low | ok |  |  | Traycer parity epic: gap analysis of capabilities Overdeck lacks |
| 221 | PAN-2565 | M | low | ok |  |  | Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging |
| 222 | PAN-2514 | M | low | ok |  |  | Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard |
| 223 | PAN-2507 | M | low | ok |  |  | Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch |
| 224 | PAN-2202 | M | low | ok |  |  | complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success |
| 225 | PAN-2069 | M | low | ok |  |  | caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view |
| 226 | PAN-1416 | M | low | ok |  |  | Workspace-spawned dashboards must never claim the canonical dashboard port |
| 227 | PAN-3288 | M | low | ok |  |  | feat(cli): dev-checkout preflight — detect stale node_modules after git pull and fail with 'run bun install' instead of ERR_MODULE_NOT_FOUND |
| 228 | PAN-3270 | M | low | ok |  |  | New workspaces have empty node_modules and bun is off PATH, so the documented bun install remedy fails |
| 229 | PAN-3235 | M | low | ok |  | PAN-3113 | Dashboard decision card: render and answer agent pane-choice menus (follow-up to PAN-3228) |
| 230 | PAN-3211 | M | low | ok |  |  | No honest disposition for closed-without-landing issues — residue rows neither close-able nor reaped |
| 231 | PAN-3181 | L | low | ok |  |  | Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch, mirroring the overdeck-state … |
| 232 | PAN-3179 | M | low | ok |  |  | A UAT promote is marked complete at merge time — nothing verifies the change reached production, so members read as shipped while prod serv… |
| 233 | PAN-3176 | M | low | ok |  |  | Block UAT batch promotion when the live stack is degraded, unknown, or still starting — the promote path takes no health evidence |
| 234 | PAN-3175 | M | low | ok |  |  | Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another |
| 235 | PAN-3174 | XS | low | ok |  |  | Every polyrepo UAT stack is unreachable: Traefik labels carry the old myn- project prefix, Traefik is never attached to the overdeck-* devn… |
| 236 | PAN-2444 | M | low | ok |  |  | feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox) |
| 237 | PAN-2443 | M | low | ok |  |  | feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption |
| 238 | PAN-2442 | M | low | ok |  |  | feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-… |
| 239 | PAN-2356 | M | low | ok |  | PAN-2353 | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door |
| 240 | PAN-2355 | M | low | ok |  | PAN-2352, PAN-2354 | Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push) |
| 241 | PAN-2354 | M | low | ok |  | PAN-2351 | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later) |
| 242 | PAN-2353 | M | low | ok |  | PAN-2351 | Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN) |
| 243 | PAN-2352 | M | low | ok |  | PAN-2351 | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access |
| 244 | PAN-3132 | L | low | ok |  |  | Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment) |
| 245 | PAN-3131 | M | low | ok |  |  | Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption |
| 246 | PAN-3120 | M | low | ok |  |  | bug(dashboard): MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent |
| 247 | PAN-3113 | M | low | ok |  |  | Surface agent-pane choice prompts as inline decision cards in the conversation view |
| 248 | PAN-3107 | M | low | ok |  |  | feat(infra): productize the memory-attribution census (OOM spikes are unattributable after the fact) |
| 249 | PAN-3099 | M | low | ok |  |  | bug(cli): pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves dashboard DOWN |
| 250 | PAN-3096 | M | low | ok |  |  | fix(pipeline): pan done fails on generated devcontainer harness — agents infer deletion of workspace infrastructure |
| 251 | PAN-3094 | M | low | ok |  |  | pan done merge fallback force-pushes a fast-forward branch |
| 252 | PAN-3077 | M | low | ok |  |  | Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default (fires per xBRIEF item) |
| 253 | PAN-3061 | M | low | ok |  |  | Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize |
| 254 | PAN-3058 | M | low | ok |  |  | Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings |
| 255 | PAN-3054 | M | low | ok |  |  | Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome |
| 256 | PAN-3040 | M | low | ok |  |  | pan strike fails on polyrepo projects (monorepo-shaped worktree logic) |
| 257 | PAN-3036 | M | low | ok |  |  | False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending question |
| 258 | PAN-3034 | M | low | ok |  |  | Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031) |
| 259 | PAN-3017 | M | low | ok |  |  | Issue-page UAT panel: expose the full stack action menu and show the panel consistently |
| 260 | PAN-3016 | M | low | ok |  |  | URL-address every view: anywhere you navigate in Overdeck, the URL must get you back there |
| 261 | PAN-3015 | M | low | ok |  |  | pan monitor: pull-based background inbox transport for Claude Code sessions |
| 262 | PAN-3014 | M | low | ok |  |  | Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209 |
| 263 | PAN-3013 | M | low | ok |  |  | linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths |
| 264 | PAN-3011 | M | low | ok |  |  | Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter |
| 265 | PAN-2983 | M | low | ok |  |  | OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor |
| 266 | PAN-2982 | M | low | ok |  |  | Review convoy should run skill selftests when sync-sources/skills/** changes |
| 267 | PAN-2981 | M | low | ok |  |  | Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions |
| 268 | PAN-2980 | M | low | ok |  |  | pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes |
| 269 | PAN-2978 | M | low | ok |  |  | Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes) |
| 270 | PAN-2977 | M | low | ok |  |  | ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings |
| 271 | PAN-2976 | M | low | ok |  |  | Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config) |
| 272 | PAN-2968 | M | low | ok |  |  | Adopt the interactive decision page as the default way to present operator decisions |
| 273 | PAN-1951 | M | low | ok |  |  | Inspector resumes a warm per-issue session instead of cold-spawning per item |
| 274 | PAN-1915 | M | low | ok |  |  | enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext |
| 275 | PAN-1912 | M | low | ok |  |  | Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle |
| 276 | PAN-1068 | M | low | ok |  |  | PAN-1048 deferred findings: security, correctness, and model validation gaps |
| 277 | PAN-813 | M | high | ok |  |  | Add regression test for /api/review/:issueId/reset preserving work-agent resolution |
| 278 | PAN-2957 | M | low | ok |  |  | npm run build intermittently produces stale frontend bundles |
| 279 | PAN-2950 | L | low | ok |  |  | Refactor god files back under file-size ceilings after the UX overhaul |
| 280 | PAN-2945 | M | low | ok |  |  | fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review) |
| 281 | PAN-2941 | M | low | ok |  |  | OKF v3 — lease-based writes and advisory semantic auditor |
| 282 | PAN-2936 | M | low | ok |  |  | Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them |
| 283 | PAN-2922 | M | low | ok |  |  | Reduce accidental orchestration complexity after performance stabilization |
| 284 | PAN-2896 | M | low | ok |  |  | Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute |
| 285 | PAN-2886 | M | low | ok |  |  | Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever |
| 286 | PAN-2883 | M | low | ok |  |  | Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs |
| 287 | PAN-2880 | M | low | ok |  |  | Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget |
| 288 | PAN-2874 | M | low | ok |  |  | Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback delivery… |
| 289 | PAN-2868 | M | low | ok |  |  | Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized |
| 290 | PAN-2850 | M | low | ok |  |  | npm test fails in clean checkout after pretest removes dashboard bundle |
| 291 | PAN-2836 | L | low | ok |  |  | okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later |
| 292 | PAN-2813 | M | low | ok |  |  | Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges |
| 293 | PAN-2810 | M | low | ok |  |  | Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock |
| 294 | PAN-2809 | M | low | ok |  |  | Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403) |
| 295 | PAN-2806 | M | low | ok |  |  | bug(cloister): strike merge trigger registry splits across dashboard chunks |
| 296 | PAN-2796 | M | low | ok |  |  | fix(cloister): idle nudge must not advance after failed mandatory inspection |
| 297 | PAN-2755 | M | low | ok |  |  | bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path |
| 298 | PAN-2754 | M | low | ok |  |  | bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec |
| 299 | PAN-2718 | M | low | ok |  |  | pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator |
| 300 | PAN-2680 | M | low | ok |  |  | pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out |
| 301 | PAN-2679 | M | low | ok |  |  | conv-lookup skill: resolve transcripts for codex and pi harness conversations |
| 302 | PAN-2678 | M | low | ok |  |  | Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage) |
| 303 | PAN-2668 | M | low | ok |  |  | Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery |
| 304 | PAN-2667 | M | low | ok |  |  | Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up) |
| 305 | PAN-2008 | M | low | ok |  |  | feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice) |
| 306 | PAN-2006 | M | low | ok |  |  | Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition |
| 307 | PAN-2005 | M | low | ok |  |  | Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck) |
| 308 | PAN-1868 | M | low | ok |  |  | Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend |
| 309 | PAN-1828 | M | low | ok |  |  | Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion |
| 310 | PAN-1816 | M | low | ok |  |  | Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-cl… |
| 311 | PAN-1795 | M | low | ok |  |  | Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap) |
| 312 | PAN-1769 | L | low | ok |  |  | Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ea… |
| 313 | PAN-1758 | M | low | ok |  |  | Watch: ready-for-merge work must converge despite a continuously moving main |
| 314 | PAN-1578 | M | high | ok |  |  | GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex) |
| 315 | PAN-1561 | M | high | ok |  |  | feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed) |
| 316 | PAN-1558 | M | high | ok |  |  | Review/specialist agents should run in the workspace Docker container, not inherit host-override |
| 317 | PAN-1544 | M | high | ok |  |  | Type cleanup: strip 'ship' from the Role union and its ~10 downstream references |
| 318 | PAN-2662 | M | low | ok |  |  | Add project context-menu actions scoped to issues currently in the pipeline |
| 319 | PAN-2652 | M | low | ok |  |  | Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resoluti… |
| 320 | PAN-2651 | M | low | ok |  |  | fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset |
| 321 | PAN-2646 | M | low | ok |  |  | feat(swarm): configurable global/project/issue policy UI with default OFF |
| 322 | PAN-2635 | M | low | ok |  |  | chore(server): pay down the 152-error src/dashboard/server typecheck debt |
| 323 | PAN-2630 | M | low | ok |  |  | pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it |
| 324 | PAN-2629 | M | low | ok |  |  | pan start kickoff delivery never lands: "Claude Code did not become ready within 30s" (both attempts), agent sits idle at empty prompt |
| 325 | PAN-2628 | M | low | ok |  |  | pan close aborts at close-issue:transition: "No tracker available and cannot determine issue type" for GitHub-tracker project |
| 326 | PAN-2626 | M | low | ok |  |  | feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable) |
| 327 | PAN-2625 | M | low | ok |  |  | feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue |
| 328 | PAN-2622 | M | low | ok |  |  | cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs |
| 329 | PAN-2608 | M | low | ok |  |  | Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone |
| 330 | PAN-2600 | M | low | ok |  |  | Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597 |
| 331 | PAN-2572 | M | low | ok |  |  | Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken |
| 332 | PAN-2560 | L | low | ok |  |  | resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall back … |
| 333 | PAN-2557 | M | low | ok |  |  | feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor |
| 334 | PAN-2553 | M | low | ok |  |  | feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs |
| 335 | PAN-2549 | L | low | ok |  |  | Fly remote workspaces: sync overdeck-state before re-enabling migrated projects |
| 336 | PAN-2548 | M | low | ok |  | PAN-2558 | chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker |
| 337 | PAN-2533 | XS | low | ok |  |  | UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api |
| 338 | PAN-2527 | M | low | ok |  |  | Harness selector should restrict OpenAI models to Claude Code only |
| 339 | PAN-2526 | M | low | ok |  |  | Refactor deacon.ts below file-size baseline |
| 340 | PAN-2506 | M | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized |
| 341 | PAN-2505 | M | low | ok |  |  | lint:circular reports new frontend cycles + stale baseline in chat/conversations components |
| 342 | PAN-1984 | L | low | ok |  | PAN-1983 | Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up) |
| 343 | PAN-1983 | XS | low | ok |  |  | Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy) |
| 344 | PAN-1918 | M | low | ok |  |  | bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls … |
| 345 | PAN-1674 | M | low | ok |  |  | TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC |
| 346 | PAN-1673 | M | low | ok |  |  | Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously) |
| 347 | PAN-1641 | M | low | ok |  |  | Run agents on local GPU models via a managed Ollama sidecar |
| 348 | PAN-1624 | M | low | ok |  |  | pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen |
| 349 | PAN-1538 | M | high | ok |  |  | Unblock Pi source forks — remove API guard, verify transcript parsers |
| 350 | PAN-1424 | M | high | needs-refinement |  |  | Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122) |
| 351 | PAN-1357 | M | high | ok |  |  | Template conversations: load curated skill bundles into a single conversation |
| 352 | PAN-2504 | M | low | ok |  |  | Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node |
| 353 | PAN-2501 | M | low | ok |  |  | bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/**… |
| 354 | PAN-2493 | M | low | ok |  |  | feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) |
| 355 | PAN-2492 | M | low | ok |  |  | bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only the… |
| 356 | PAN-2491 | L | low | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall |
| 357 | PAN-2489 | M | low | ok |  |  | bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click |
| 358 | PAN-2487 | M | low | ok |  |  | feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner |
| 359 | PAN-2484 | M | low | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ad… |
| 360 | PAN-2469 | M | low | ok |  |  | feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-238… |
| 361 | PAN-2466 | M | low | ok |  |  | bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring) |
| 362 | PAN-2465 | M | low | ok |  |  | bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero |
| 363 | PAN-2454 | M | low | ok |  |  | bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches |
| 364 | PAN-2449 | M | low | ok |  |  | start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue |
| 365 | PAN-2428 | XS | low | ok |  |  | bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make… |
| 366 | PAN-2423 | M | low | ok |  |  | bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification containe… |
| 367 | PAN-2422 | M | low | ok |  |  | bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js' |
| 368 | PAN-2416 | M | low | ok |  |  | bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively |
| 369 | PAN-2414 | M | low | ok |  |  | bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation r… |
| 370 | PAN-2409 | M | low | ok |  |  | feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07-0… |
| 371 | PAN-2408 | M | low | ok |  |  | bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-works… |
| 372 | PAN-2406 | M | low | ok |  |  | close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree remo… |
| 373 | PAN-2399 | M | low | ok |  |  | feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b) |
| 374 | PAN-2395 | M | low | ok |  |  | bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation… |
| 375 | PAN-2394 | M | low | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts ("no saved history") |
| 376 | PAN-2392 | M | low | ok |  |  | feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included) |
| 377 | PAN-2390 | M | low | ok |  |  | systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on th… |
| 378 | PAN-2381 | M | low | ok |  |  | bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent "Reconnecting…" loop |
| 379 | PAN-2348 | L | low | ok |  |  | docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete |
| 380 | PAN-2347 | S | low | ok |  |  | docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful |
| 381 | PAN-2346 | S | low | ok |  |  | docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful |
| 382 | PAN-2345 | S | low | ok |  |  | docs: refresh pan-done.md — update, harden, make useful |
| 383 | PAN-2344 | S | low | ok |  |  | docs: refresh KANBAN-MODEL.md — update, harden, make useful |
| 384 | PAN-2343 | S | low | ok |  |  | docs: refresh MISSION-CONTROL.md — update, harden, make useful |
| 385 | PAN-2335 | M | low | ok |  |  | chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do N… |
| 386 | PAN-2308 | L | low | ok |  |  | hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (f… |
| 387 | PAN-2295 | M | low | needs-refinement |  |  | feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration |
| 388 | PAN-2288 | M | low | ok |  |  | tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up) |
| 389 | PAN-2287 | M | low | ok |  |  | bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file |
| 390 | PAN-2282 | M | low | ok |  |  | Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353) |
| 391 | PAN-2280 | M | low | ok |  |  | Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.) |
| 392 | PAN-2266 | M | low | ok |  |  | feat: add zcode harness and make it the default for glm-5.2 |
| 393 | PAN-2027 | M | high | ok |  |  | ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion) |
| 394 | PAN-1852 | M | low | ok |  |  | Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data |
| 395 | PAN-1577 | M | low | ok |  |  | Move a conversation to a different project (CLI + drag/drop + menu action) |
| 396 | PAN-1571 | M | low | ok |  |  | Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed "[Pasted text +N lines]"… |
| 397 | PAN-1565 | M | low | ok |  |  | Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147) |
| 398 | PAN-1556 | M | low | ok |  |  | Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent |
| 399 | PAN-1313 | M | high | ok |  |  | Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces |
| 400 | PAN-1311 | M | high | needs-refinement |  |  | Swarm: fast-track tier — skip slot dispatch for trivial mechanical items |
| 401 | PAN-1254 | M | high | ok |  |  | Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native) |
| 402 | PAN-1253 | M | high | ok |  |  | Flywheel: respect issue dependencies before autopicking work |
| 403 | PAN-1246 | M | high | ok |  |  | Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586) |
| 404 | PAN-1196 | M | high | needs-refinement |  |  | Workhorse routing by bead difficulty + subject-matter (single-agent and swarm) |
| 405 | PAN-1142 | M | high | ok |  |  | Add reasoning effort level to per-role / per-conversation model config |
| 406 | PAN-2213 | M | low | ok |  |  | Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one |
| 407 | PAN-2212 | M | low | ok |  |  | Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero |
| 408 | PAN-2211 | M | low | ok |  |  | PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready |
| 409 | PAN-2210 | M | low | ok |  |  | PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline |
| 410 | PAN-2201 | XS | low | ok |  |  | Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels |
| 411 | PAN-2197 | M | low | ok |  |  | bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled' |
| 412 | PAN-2195 | M | low | ok |  |  | pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan |
| 413 | PAN-2091 | M | low | stale |  |  | chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl) |
| 414 | PAN-2085 | M | low | ok |  |  | Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces) |
| 415 | PAN-2084 | M | low | ok |  |  | Auto-create lightweight conversation worktrees on project chats |
| 416 | PAN-2083 | M | low | ok |  |  | Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox |
| 417 | PAN-2082 | M | low | ok |  |  | Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net) |
| 418 | PAN-1913 | S | high | ok |  |  | Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon) |
| 419 | PAN-1461 | M | low | ok |  |  | Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows |
| 420 | PAN-1449 | M | low | ok |  |  | PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec |
| 421 | PAN-1446 | M | low | ok |  |  | PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs) |
| 422 | PAN-1445 | M | low | ok |  |  | PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs) |
| 423 | PAN-1444 | M | low | ok |  | PAN-1416 | Follow-up to PAN-1416: dashboard port lockfile + pan doctor multi-instance check |
| 424 | PAN-1440 | M | low | ok |  |  | Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause |
| 425 | PAN-1438 | M | low | ok |  |  | pan flywheel start launcher process orphans when orchestrator dies externally |
| 426 | PAN-1436 | M | low | ok |  |  | PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list |
| 427 | PAN-1435 | XS | low | ok |  |  | API keys in ~/.panopticon/config.yaml stored as plaintext |
| 428 | PAN-1433 | M | low | ok |  |  | Conversation agents can leave host main repo in abandoned git rebase state for hours |
| 429 | PAN-1392 | M | low | ok |  |  | pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists |
| 430 | PAN-1386 | M | low | ok |  |  | Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run |
| 431 | PAN-1330 | M | low | ok |  |  | CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort' |
| 432 | PAN-1219 | M | high | ok |  |  | Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived |
| 433 | PAN-1217 | M | high | ok |  |  | Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items |
| 434 | PAN-3133 | S | low | needs-refinement |  |  | Spike: TRON encoding for prompt-bound xBRIEF payloads |
| 435 | PAN-2065 | M | low | ok |  |  | feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter) |
| 436 | PAN-2046 | M | low | ok |  |  | Conversation view does not surface terminal command responses |
| 437 | PAN-2004 | M | low | ok |  |  | Resumable Planning node: double-click a planned issue's Planning to resume the planning agent |
| 438 | PAN-2002 | M | low | ok |  |  | [HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID) |
| 439 | PAN-1999 | M | low | ok |  |  | Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN) |
| 440 | PAN-1995 | M | low | ok |  |  | infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only) |
| 441 | PAN-1242 | M | low | ok |  |  | Create a new issue directly from a kanban column |
| 442 | PAN-1240 | M | low | ok |  |  | Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery |
| 443 | PAN-1227 | M | low | stale |  |  | Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done |
| 444 | PAN-1226 | L | low | ok |  |  | PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit) |
| 445 | PAN-1173 | M | low | ok |  |  | pan show <bare-number> derives wrong agent ID for PAN-prefixed issues |
| 446 | PAN-1164 | M | low | ok |  |  | Conversation diff summaries update live over WebSocket (drop 5s polling) |
| 447 | PAN-1150 | M | low | ok |  |  | Settings: "Anthropic is not configured" warning persists in Model Routing after claude /login (Provider tab disagrees) |
| 448 | PAN-1149 | M | low | ok |  |  | v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves |
| 449 | PAN-1988 | M | low | ok |  |  | Verdict signaling: one host-owned write door; agents journal, host owns the DB cache |
| 450 | PAN-1986 | M | low | ok |  |  | restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row |
| 451 | PAN-1980 | M | low | ok |  |  | Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses |
| 452 | PAN-1968 | XS | low | ok |  |  | Finish local-domain rename: pan.localhost → overdeck.localhost |
| 453 | PAN-1967 | M | low | ok |  |  | Flywheel must re-validate (re-plan) pre-cutover plans before implementing them |
| 454 | PAN-1965 | M | low | ok |  |  | Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue) |
| 455 | PAN-1958 | M | low | ok |  |  | Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source) |
| 456 | PAN-1949 | M | low | ok |  |  | Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts |
| 457 | PAN-1937 | M | low | ok |  |  | feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data |
| 458 | PAN-1936 | M | low | ok |  |  | Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints) |
| 459 | PAN-1926 | M | low | ok |  |  | feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes) |
| 460 | PAN-1916 | M | low | ok |  |  | feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity) |
| 461 | PAN-1837 | L | high | ok |  |  | Support Kimi Code as a first-class harness (Moonshot's own coding CLI) |
| 461 | PAN-1914 | M | low | ok |  |  | Follow-up: move /api/health/agents off agent-directory scans |
| 462 | PAN-1910 | XS | low | ok |  |  | fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth |
| 463 | PAN-1907 | M | low | ok |  |  | Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywher… |
| 464 | PAN-1906 | M | low | ok |  |  | Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere |
| 465 | PAN-1895 | M | low | ok |  |  | Spawn work agents from issue workspace slide-out |
| 466 | PAN-1533 | M | low | ok |  |  | Fork-into-worktree from conversation branch chip |
| 467 | PAN-1129 | M | low | ok |  |  | Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977' |
| 468 | PAN-1128 | M | low | ok |  |  | Channels: spurious 'no MCP server configured with that name' banner at conversation startup |
| 469 | PAN-1113 | M | low | ok |  |  | Conversations sidebar lets you message review-specialist sessions, which derails them silently |
| 470 | PAN-538 | M | low | ok |  |  | pan reload freshness guard must also verify the frontend bundle |
| 471 | PAN-1878 | M | low | ok |  |  | process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts |
| 472 | PAN-1854 | M | low | ok |  |  | Define handoff strategy for large conversations: external vs source authoring + tail-biased read |
| 473 | PAN-1853 | M | low | ok |  |  | Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers) |
| 474 | PAN-1846 | M | low | ok |  |  | bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol |
| 475 | PAN-1844 | M | low | ok |  |  | Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view |
| 476 | PAN-1840 | M | low | ok |  |  | Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard) |
| 477 | PAN-1839 | M | low | ok |  |  | Settings → Providers: show each provider's default harness in the collapsed row (no expand needed) |
| 478 | PAN-1782 | M | low | ok |  |  | Handoff forks stall at "Injecting…" then die on double 300s summary timeout — decouple precompaction from the handoff author model |
| 479 | PAN-1774 | M | low | ok |  |  | bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing |
| 480 | PAN-1773 | M | low | ok |  |  | Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762) |
| 481 | PAN-1761 | M | low | ok |  |  | bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-… |
| 482 | PAN-1755 | M | low | ok |  |  | bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation |
| 483 | PAN-1754 | M | low | ok |  |  | feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page |
| 484 | PAN-1751 | M | low | ok |  |  | feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel |
| 485 | PAN-1750 | M | low | ok |  |  | feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex) |
| 486 | PAN-1748 | M | low | ok |  |  | feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay) |
| 487 | PAN-1740 | XS | low | ok |  |  | Deacon mislabels SIGTERM workspace container restarts as crashes |
| 488 | PAN-1735 | M | low | ok |  |  | feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue |
| 489 | PAN-1728 | M | low | ok |  |  | bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch |
| 490 | PAN-1720 | M | low | ok |  |  | bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main |
| 491 | PAN-1710 | M | low | ok |  |  | bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server b… |
| 492 | PAN-1691 | M | low | ok |  |  | feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs |
| 493 | PAN-1685 | XS | low | ok |  |  | Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit |
| 494 | PAN-1223 | M | low | ok |  |  | Auto-update for users in the field (npm + desktop binaries) |
| 495 | PAN-1166 | M | low | ok |  |  | Re-introduce /ws/terminal auth gate with a working bootstrap path |
| 496 | PAN-1027 | M | low | ok |  |  | Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert |
| 497 | PAN-1676 | M | low | ok |  |  | feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots) |
| 498 | PAN-1672 | M | low | ok |  |  | GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion |
| 499 | PAN-1669 | M | low | ok |  |  | bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh |
| 500 | PAN-1668 | M | low | ok |  |  | bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi |
| 501 | PAN-1667 | M | low | ok |  |  | feat(dashboard): unify Agents + Resources into one issue-centric holistic view |
| 502 | PAN-1657 | M | low | ok |  |  | feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer |
| 503 | PAN-1656 | M | low | ok |  |  | Skills page: make it a full management surface (browse, review, edit, scope, sync status) |
| 504 | PAN-1655 | M | low | ok |  |  | Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly |
| 505 | PAN-1654 | M | low | ok |  |  | perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace) |
| 506 | PAN-1653 | M | low | ok |  |  | perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace) |
| 507 | PAN-1646 | M | low | ok |  |  | Rabbit-hole drift detection and lift-to-new-conversation |
| 508 | PAN-1643 | M | low | ok |  |  | Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker |
| 509 | PAN-1640 | M | low | ok |  |  | Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic) |
| 510 | PAN-1627 | M | low | ok |  |  | Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approve … |
| 511 | PAN-1623 | M | low | ok |  |  | Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion) |
| 512 | PAN-947 | M | low | ok |  |  | feat: project management actions in unified sidebar |
| 513 | PAN-933 | M | low | ok |  |  | Review poster cannot post to GitLab MRs (only supports GitHub PRs) |
| 514 | PAN-932 | M | low | ok |  |  | pan done: polyrepo uncommitted changes check + existing MR handling |
| 515 | PAN-900 | M | low | ok |  |  | Trust devroot for conversations + atomic .claude.json writes |
| 516 | PAN-2074 | S | low | needs-refinement |  |  | research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house |
| 517 | PAN-1830 | M | low | ok |  |  | Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696) |
| 518 | PAN-1592 | M | low | ok |  |  | Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text) |
| 519 | PAN-1581 | M | low | ok |  |  | Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync |
| 520 | PAN-1572 | M | low | ok |  |  | Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto' |
| 521 | PAN-1552 | M | low | ok |  |  | Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log |
| 522 | PAN-1550 | M | low | ok |  |  | feat: FilesPane + BrowserPane — file browser and embedded web view implementation details |
| 523 | PAN-1545 | M | low | ok |  |  | feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette |
| 524 | PAN-1542 | M | low | ok |  |  | Spawn-refusal modal: render the three-button workflow on dirty-workspace 409 |
| 525 | PAN-1530 | M | low | needs-refinement |  |  | Investigate: state.json with model='gpt-5.5' (a model that doesn't exist) |
| 526 | PAN-886 | M | low | ok |  |  | pan review request shows 'fetch failed' instead of actual sync-target-branch error |
| 527 | PAN-863 | M | low | ok |  |  | One-shot sweep of stale feature branches and worktrees predating the reaper |
| 528 | PAN-630 | M | high | ok |  |  | Multi-tenant workspace isolation with ACLs |
| 529 | PAN-2073 | S | low | ok |  |  | docs: add user-facing page for the Desktop App |
| 530 | PAN-2071 | S | low | ok |  |  | docs: add user-facing page for the Hooks system |
| 531 | PAN-2070 | S | low | ok |  |  | docs: add user-facing page for the Flywheel orchestrator |
| 532 | PAN-2068 | S | low | ok |  |  | docs: add user-facing page for Caveman (agent output compression) |
| 533 | PAN-2067 | S | low | ok |  |  | docs: add user-facing page for RTK (Bash output compression) |
| 534 | PAN-1524 | M | low | ok |  |  | Slash command aliases: /handoff → /pan-handoff (and similar short forms) |
| 535 | PAN-1490 | M | low | ok |  |  | feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern) |
| 536 | PAN-1489 | M | low | needs-refinement |  |  | task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry |
| 537 | PAN-1485 | M | low | ok |  |  | Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable |
| 538 | PAN-1483 | XS | low | ok |  |  | Distinguish general-use skills from Panopticon-only dev skills in pan sync |
| 539 | PAN-1482 | M | low | ok |  |  | Token spend report should aggregate data from repo, not just local machine |
| 540 | PAN-1481 | M | low | ok |  |  | Add cost-event telemetry for Caveman token savings |
| 541 | PAN-1480 | M | low | ok |  |  | TLDR: 93% bypass rate — daemon/hook integration broken |
| 542 | PAN-1479 | M | low | ok |  |  | RTK: Add telemetry to measure token savings from bash output compression |
| 543 | PAN-1473 | M | low | ok |  |  | Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately) |
| 544 | PAN-1443 | L | low | ok |  |  | Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/ |
| 545 | PAN-1442 | M | low | ok |  |  | Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo |
| 546 | PAN-1437 | M | low | ok |  |  | pan flywheel report semantics: split read-only snapshot from run finalization |
| 547 | PAN-1432 | M | low | ok |  |  | Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout |
| 548 | PAN-1356 | M | low | ok |  |  | Extend the memory Observation pipeline to ad-hoc conversations |
| 549 | PAN-1325 | M | low | ok |  |  | Artifact storage model is unsafe for polyrepo projects — define a canonical "orchestration repo" |
| 550 | PAN-2035 | M | low | ok |  |  | ohmypi: GitHub Copilot subscription provider routing via omp |
| 551 | PAN-2034 | L | low | ok |  |  | ohmypi: end-to-end test that tool-call steps render in Conversation panel |
| 552 | PAN-2033 | M | low | ok |  |  | ohmypi: benchmark FIFO vs paste-buffer message delivery latency |
| 553 | PAN-2032 | M | low | ok |  |  | ohmypi: local Ollama model as zero-cost preliminary review role |
| 554 | PAN-2031 | M | low | ok |  |  | ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate |
| 555 | PAN-2030 | M | low | ok |  |  | ohmypi: version-pin extension in package.json and pan doctor mismatch warning |
| 556 | PAN-2029 | M | low | ok |  |  | ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting |
| 557 | PAN-2028 | M | low | ok |  |  | ohmypi: per-provider cost grouping in cost dashboard |
| 558 | PAN-2026 | M | low | ok |  |  | ohmypi: surface 35+ provider matrix in dashboard model picker |
| 559 | PAN-2025 | M | low | ok |  |  | ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks |
| 560 | PAN-2024 | M | low | ok |  |  | ohmypi: frontend Tools-toggle for conversation view |
| 561 | PAN-1245 | M | low | ok |  |  | Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report) |
| 562 | PAN-1244 | M | low | ok |  |  | pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server |
| 563 | PAN-1222 | M | low | ok |  |  | Project-templated DB lifecycle: auxiliary databases + seed refresh from prod |
| 564 | PAN-1208 | M | low | ok |  |  | Polyrepo: support non-feature 'main' workspaces alongside feature-* |
| 565 | PAN-1165 | M | low | ok |  |  | Lightweight review path for small/trivial PRs |
| 566 | PAN-1154 | M | low | ok |  |  | pan up does not kill existing port holders — startup races against orphan dashboard servers |
| 567 | PAN-1153 | M | low | ok |  |  | Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy |
| 568 | PAN-1152 | XS | low | ok |  |  | Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command |
| 569 | PAN-1151 | M | low | ok |  |  | Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating |
| 570 | PAN-1136 | M | low | stale |  |  | Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency |
| 571 | PAN-1135 | M | low | ok |  |  | Document the hook system in docs/HOOKS.md |
| 572 | PAN-681 | M | low | ok |  |  | Feedback routing: wrong issueId written to workspace when verification runs for co-active issues |
| 573 | PAN-1985 | M | low | ok |  |  | Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation |
| 574 | PAN-1133 | M | low | ok |  |  | TLDR: deacon supervision + pan doctor check + GC |
| 575 | PAN-1124 | M | low | ok |  |  | Decouple specs and PRDs from workspaces — write directly to main |
| 576 | PAN-1123 | M | low | ok |  |  | Channels delivery: surface failures, add fallback toggle, route conversations through channels |
| 577 | PAN-1121 | M | low | stale |  |  | Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction |
| 578 | PAN-1117 | M | low | ok |  |  | Memory: pinned docs (long-form doc chunking + retrieval) |
| 579 | PAN-1116 | M | low | ok |  |  | Memory: cross-project search mode |
| 580 | PAN-1065 | M | low | ok |  |  | Validate issueId at every shell-string interpolation site (defense in depth) |
| 581 | PAN-1064 | M | low | ok |  |  | Harden launcher generation against shell-quote injection (model and arg quoting) |
| 582 | PAN-1063 | M | low | ok |  |  | Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound |
| 583 | PAN-1060 | M | low | ok |  |  | Self-modify permission handling: stop the interrupt loop without weakening the safety guard |
| 584 | PAN-578 | M | low | ok |  |  | Security: Comment mediation layer to prevent prompt injection via tracker comments |
| 585 | PAN-532 | M | low | ok |  |  | Per-project and per-issue model overrides for pipeline roles |
| 586 | PAN-1684 | S | low | ok |  |  | docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed |
| 587 | PAN-1683 | S | low | ok |  |  | docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out o… |
| 588 | PAN-1051 | M | low | ok |  |  | feat: Subspace-inspired alternate theme with Inter + JetBrains Mono |
| 589 | PAN-1042 | M | low | ok |  |  | cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions |
| 590 | PAN-1041 | M | low | ok |  |  | Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template |
| 591 | PAN-1040 | M | low | stale |  |  | feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads) |
| 592 | PAN-1037 | M | low | ok |  |  | Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase |
| 593 | PAN-962 | M | low | stale |  |  | Post-PAN-946: vBRIEF lifecycle follow-up plan |
| 594 | PAN-961 | M | low | stale |  |  | Update documentation for vBRIEF v0.6 lifecycle model |
| 595 | PAN-958 | L | low | stale |  |  | Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification |
| 596 | PAN-658 | M | low | ok |  |  | Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport |
| 597 | PAN-1553 | M | low | needs-refinement |  |  | Investigate Claude Code Fast mode support (and fast-tier pricing) |
| 598 | PAN-1130 | M | low | ok |  |  | Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart |
| 599 | PAN-949 | M | low | ok |  |  | feat: add conversation for project from sidebar |
| 600 | PAN-944 | M | low | stale |  |  | Make vBRIEF the durable task graph source of truth |
| 601 | PAN-943 | M | low | ok |  |  | Add memory file review and management command |
| 602 | PAN-938 | M | low | stale |  |  | Fizzy visual pipeline — Kanban mirror for specialist pipeline |
| 603 | PAN-927 | L | low | ok |  |  | Rewrite containerize route: dead code, orphan processes, no pending-op tracking |
| 604 | PAN-908 | M | low | ok |  |  | PAN-908: Make work-agent spawn limits configurable and overridable |
| 605 | PAN-903 | M | low | ok |  |  | Detect ~/.claude.json corruption on startup and surface it in the dashboard |
| 606 | PAN-902 | M | low | ok |  |  | Settings: add 'Run pan sync' button to configuration menu |
| 607 | PAN-901 | M | low | ok |  |  | Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch |
| 608 | PAN-898 | M | low | ok |  |  | Dashboard polling and WebSocket efficiency: remaining audit findings |
| 609 | PAN-833 | M | low | ok |  |  | Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader) |
| 610 | PAN-832 | M | low | stale |  |  | state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity |
| 611 | PAN-818 | M | low | ok |  |  | Make summary optional when forking conversations |
| 612 | PAN-817 | M | low | ok |  |  | Improve planning dialog layout and content fit |
| 613 | PAN-810 | M | low | ok |  |  | Inspector: diagnostic UI when pipeline phase is unknown |
| 614 | PAN-802 | M | low | ok |  |  | Resume on conversation session forks instead of resuming |
| 615 | PAN-797 | M | low | ok |  |  | Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy |
| 616 | PAN-334 | M | low | stale |  |  | Dashboard server has no duplicate-process protection — zombie instances cause 502 |
| 617 | PAN-262 | M | high | stale |  |  | Refactor post-merge lifecycle into composable, idempotent operations |
| 618 | PAN-1474 | S | low | ok |  |  | Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0) |
| 619 | PAN-1469 | L | low | ok |  |  | End-to-end review and consolidation of all project documentation |
| 620 | PAN-793 | XS | low | ok |  |  | Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine |
| 621 | PAN-791 | XS | low | ok |  |  | Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI |
| 622 | PAN-790 | M | low | ok |  |  | PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration |
| 623 | PAN-786 | M | low | ok |  |  | Post planning Q\&A answers as issue comment |
| 624 | PAN-778 | M | low | ok |  |  | Write conflict race: review-agent fails when test-agent write scope not yet released |
| 625 | PAN-777 | M | low | ok |  |  | Inter-agent communication skill: send messages to conversation-mode agents |
| 626 | PAN-775 | L | low | ok |  |  | Redesign workspace inspector panel: sidebar layout is cramped and wrong |
| 627 | PAN-774 | M | low | ok |  |  | Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds |
| 628 | PAN-773 | M | low | ok |  |  | Design prompt-style overlays with model hierarchy and scoped toggles |
| 629 | PAN-772 | M | low | ok |  |  | Unify terminal stack behavior across tmux sessions |
| 630 | PAN-769 | M | low | ok |  |  | Track verification/review/test phase churn over time |
| 631 | PAN-765 | M | low | ok |  |  | Preserve trailing zeros in cost displays |
| 632 | PAN-764 | M | low | ok |  |  | Add quota/usage inspector for routed model providers |
| 633 | PAN-762 | M | low | ok |  |  | Settings: warn when model overrides target disabled providers |
| 634 | PAN-752 | M | low | ok |  |  | Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro |
| 635 | PAN-751 | M | low | ok |  |  | PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window |
| 636 | PAN-750 | L | low | ok |  |  | PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics |
| 637 | PAN-747 | XS | low | ok |  |  | Conversation list items lack accessible labels in accessibility tree |
| 638 | PAN-743 | XS | low | ok |  |  | Add consistent new conversation icon actions in Command Deck |
| 639 | PAN-738 | M | low | ok |  |  | Add right-click fork option to conversation list |
| 640 | PAN-736 | M | low | ok |  |  | feat: wire per-subagent model overrides from settings to Claude Code spawn env |
| 641 | PAN-735 | M | low | ok |  |  | Settings page: review and configure overridden subagent model files |
| 642 | PAN-730 | M | low | ok |  |  | Add provider account telemetry for credits, balances, and usage |
| 643 | PAN-324 | M | low | stale |  |  | Agent detail pane missing Merge/Approve button |
| 644 | PAN-727 | M | low | ok |  |  | Fix orphaned work-agent start handoff after planning |
| 645 | PAN-713 | M | low | ok |  |  | test: add unit tests for doneCommand and approveCommand |
| 646 | PAN-709 | M | low | ok |  |  | feat(flywheel): self-improving flywheel — retro agent, skill-change pipeline, audience-scoped skills, Q&A detection, autonomous daemon |
| 647 | PAN-702 | M | low | ok |  |  | OpenAI provider: add plan/subscription support and fix unregistered model resolution |
| 648 | PAN-701 | M | low | ok |  |  | Quick-Create conversation via keystroke using Conversations-page default model |
| 649 | PAN-700 | M | low | ok |  |  | Detachable terminal for conversation view — popout into OS window |
| 650 | PAN-687 | M | low | ok |  |  | Support OpenCode as alternative coding agent |
| 651 | PAN-678 | M | low | ok |  |  | pan work issue --auto: headless planning → agent handoff without interactive dialog |
| 652 | PAN-675 | M | low | ok |  |  | Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets |
| 653 | PAN-663 | XS | low | ok |  |  | Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces |
| 654 | PAN-660 | M | low | ok |  |  | Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen |
| 655 | PAN-654 | M | low | ok |  |  | Project Setup Wizard — Dashboard UI |
| 656 | PAN-649 | M | low | ok |  |  | Render Excalidraw drawings inline in Claude Code conversations |
| 657 | PAN-646 | M | low | ok |  |  | Canceled issues: add guided Recover workflow |
| 658 | PAN-637 | M | low | ok |  |  | Direct issue kickoff (skip planning) from dashboard UI |
| 659 | PAN-629 | M | low | ok |  |  | Workspace quotas and resource governance |
| 660 | PAN-624 | M | low | ok |  |  | Loop nodes: iterative agent execution with conditional termination |
| 661 | PAN-623 | M | low | ok |  |  | Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks |
| 662 | PAN-622 | M | low | ok |  |  | YAML workflow DAGs: custom per-project pipeline definitions |
| 663 | PAN-604 | M | low | ok |  |  | Hide planning agent from workspace detail pane |
| 664 | PAN-603 | M | low | ok |  |  | Plan review loop with configurable reviewer model |
| 665 | PAN-304 | M | low | stale |  |  | closeLinearDirect returns stepOk even when state update never happens |
| 666 | PAN-247 | M | low | stale |  |  | Deacon has no backoff or escalation for repeated specialist startup failures |
| 667 | PAN-245 | M | low | stale |  |  | Ctrl+C aborts planning dialog instead of copying text |
| 668 | PAN-244 | M | low | stale |  |  | Deep-wipe leaves local branch and worktree metadata behind |
| 669 | PAN-113 | M | low | stale |  |  | Dashboard 'Start Agent' returns success before verifying agent actually started |
| 670 | PAN-49 | M | low | stale |  |  | Fix CloisterService tests that require real runtime |
| 671 | PAN-1049 | S | low | needs-refinement |  |  | Spike: evaluate Tauri v2 desktop shell |
| 672 | PAN-984 | S | low | stale |  |  | Evaluate context-mode MCP server as session continuity + search layer |
| 673 | PAN-591 | XS | low | ok |  |  | Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates |
| 674 | PAN-589 | XS | low | ok |  |  | Review and update commands-skills.md with all available Panopticon skills |
| 675 | PAN-576 | M | low | ok |  |  | Global / search should include conversations in addition to workspace features |
| 676 | PAN-571 | M | low | ok |  |  | Add OpenRouter credits/plan status endpoint and UI |
| 677 | PAN-570 | XS | low | ok |  |  | Show PLAN badge on costs when under a subscription/plan |
| 678 | PAN-568 | M | low | ok |  |  | Kanban: Show workspace and tmux session counts in stats |
| 679 | PAN-565 | M | low | ok |  |  | Handle CTRL-Z to undo accidental conversation archival |
| 680 | PAN-564 | M | low | ok |  |  | Slash menu positioned incorrectly — cut off / off-screen |
| 681 | PAN-554 | M | low | ok |  |  | Add kanban board deeplinks for issue URLs |
| 682 | PAN-548 | M | low | ok |  |  | Command Deck: preserve state across navigation including URL routing for tabs |
| 683 | PAN-546 | M | low | ok |  |  | Remove claude-code-router — all providers use direct env var injection |
| 684 | PAN-543 | M | low | ok |  |  | Add confirmation dialog before applying Optimal Defaults |
| 685 | PAN-537 | M | low | ok |  |  | feat: show changed files diff summary after each agent response in activity view |
| 686 | PAN-531 | M | low | ok |  |  | PAN: Windows Electron support (WSL2 required) |
| 687 | PAN-483 | M | low | ok |  |  | Unify Resume Agent UX — all entry points should show message input |
| 688 | PAN-480 | M | low | ok |  |  | Pass --effort flag when spawning planning agents via Cloister |
| 689 | PAN-476 | M | low | ok |  |  | Agent resume with Haiku session summary instead of claude --resume |
| 690 | PAN-471 | M | low | ok |  |  | Cost reconciler: auto-trigger on agent lifecycle events with debounce |
| 691 | PAN-468 | M | low | ok |  |  | Agent test conversations pollute production database — need test isolation |
| 692 | PAN-466 | M | low | ok |  |  | Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex |
| 693 | PAN-465 | M | low | ok |  |  | Add OpenRouter as a model provider |
| 694 | PAN-463 | M | low | ok |  |  | Add Qwen 3.6+ model support |
| 695 | PAN-461 | M | low | ok |  |  | Deep-wipe multi-step progress dialog |
| 696 | PAN-459 | M | low | ok |  |  | Planning setup screen with SSE progress streaming |
| 697 | PAN-454 | M | low | ok |  |  | Crash recovery: detect orphaned agents and present recovery UI on dashboard startup |
| 698 | PAN-452 | M | low | ok |  |  | Conversation input bar — mode/permissions/workspace selectors |
| 699 | PAN-450 | M | low | ok |  |  | Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing |
| 700 | PAN-438 | L | low | ok |  |  | Migrate remaining REST polling endpoints to Effect RPC |
| 701 | PAN-924 | S | low | needs-refinement |  |  | Spike: evaluate GitNexus for Panopticon integration |
| 702 | PAN-407 | XS | low | ok |  |  | Run Panopticon from a main workspace for development isolation |
| 703 | PAN-1126 | M | low | ok |  |  | Integrate TLDR summaries into review context manifest |
| 704 | PAN-1066 | M | low | ok |  |  | Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module |
| 705 | PAN-853 | S | low | needs-refinement |  |  | Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration |
| 706 | PAN-771 | M | low | needs-refinement |  |  | Investigate Vercel Sandbox execution backend support |
| 707 | PAN-749 | S | low | needs-refinement |  |  | Research and borrow best features from gstack |
| 708 | PAN-613 | M | low | needs-refinement |  |  | Investigate thinking effort levels for agents — reduce signature corruption frequency |
| 709 | PAN-607 | S | low | needs-refinement |  |  | Evaluate Ultimate Bug Scanner (UBS) for verification gate |
| 710 | PAN-606 | S | low | needs-refinement |  |  | Evaluate MCP Agent Mail for inter-agent communication and file reservations |
| 711 | PAN-674 | S | low | ok |  |  | docs: add glossary of Panopticon domain terms |
| 712 | PAN-634 | S | low | ok |  |  | Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs |
| 713 | PAN-633 | S | low | ok |  |  | Update Cloister PRD and docs index — stale relative to implementation |
| 714 | PAN-299 | M | low | stale |  |  | Granular session state persistence across context compaction |
| 715 | PAN-298 | M | low | stale |  |  | Auto-detect package manager and runtime in workspace setup |
| 716 | PAN-297 | M | low | stale |  |  | Workspace templates: pre/post tool hooks for auto-format, typecheck, lint |
| 717 | PAN-294 | M | low | stale |  |  | Surface module initialization errors as system-level, not per-issue |
| 718 | PAN-293 | M | low | stale |  |  | Project Living Memory — per-project semantic memory for agents |
| 719 | PAN-283 | M | low | stale |  |  | Reset should sync workspace feature branch with latest main |
| 720 | PAN-277 | M | low | stale |  |  | Session reasoning capture & collaborative PRD refinement |
| 721 | PAN-271 | M | low | stale |  |  | Auto-assign Linear project from project config when creating issues |
| 722 | PAN-265 | M | low | stale |  |  | Review skill categorization: all skills available everywhere via personal + workspace |
| 723 | PAN-258 | M | low | stale |  |  | Kanban board: fit all columns without horizontal scrolling |
| 724 | PAN-255 | M | low | stale |  |  | Agents lack awareness of MCP tools — sync MCP config and inject into prompts |
| 725 | PAN-252 | M | low | stale |  |  | Disable Sync with Main button when workspace is up to date |
| 726 | PAN-249 | M | low | stale |  |  | Add data-testid attributes across dashboard UI and create Playwright smoke test suite |
| 727 | PAN-243 | M | low | stale |  |  | Audit dashboard actions: ensure all are available via CLI |
| 728 | PAN-241 | L | low | stale |  |  | Mobile redesign initiative: full UX/UI overhaul + implementation plan |
| 729 | PAN-228 | M | low | stale |  |  | Shift-left post-edit diagnostics — type check after every edit |
| 730 | PAN-227 | M | low | stale |  |  | Phase gate validation — mid-implementation acceptance checks |
| 731 | PAN-198 | M | low | stale |  |  | Structured audit trail for agent actions |
| 732 | PAN-190 | M | low | stale |  |  | PAN-190: Specialized reviewer prompts (industry best-practice checklists) |
| 733 | PAN-180 | M | low | stale |  |  | PAN-180: Cross-terminal file locking for concurrent agents |
| 734 | PAN-178 | M | low | stale |  |  | PAN-178: Crash recovery with granular task checkpointing |
| 735 | PAN-177 | M | low | stale |  |  | PAN-177: Iteration limits with escalation for autonomous agents |
| 736 | PAN-176 | M | low | stale |  |  | PAN-176: Hook-enforced delegation guardrails for specialist agents |
| 737 | PAN-175 | M | low | stale |  |  | PAN-175: Pre-compact auto-save hook for agent sessions |
| 738 | PAN-155 | L | low | stale |  |  | PAN-155: Redesign health page with Stitch (system overview, timeline, costs) |
| 739 | PAN-146 | M | low | stale |  |  | PAN-146: Refine light mode theming across all dashboard pages |
| 740 | PAN-106 | M | low | stale |  |  | Cost prediction/estimation for in-progress work |
| 741 | PAN-77 | XS | low | stale |  |  | Cost breakdown modal: show costs by stage and model when clicking cost badge |
| 742 | PAN-55 | M | low | stale |  |  | Track specialist costs with time period filtering |
| 743 | PAN-54 | M | low | stale |  |  | feat: Add pan test:e2e command for full workflow integration test |
| 744 | PAN-52 | XS | low | stale |  |  | Guidance needed: Running complex multi-container projects with Panopticon worktrees |
| 745 | PAN-51 | M | low | stale |  |  | Documentation: Clarify issue tracker options beyond Linear |
| 746 | PAN-47 | M | low | stale |  |  | PRD files should be committed to feature branch, moved to completed/ on merge |
| 747 | PAN-44 | M | low | stale |  |  | Planning should fetch ALL issue context: comments, attachments, linked issues, discussions |
| 748 | PAN-43 | M | low | stale |  |  | Add Slack and email notifications for agent events |
| 749 | PAN-38 | M | low | stale |  |  | Support multiple merge agents per repository |
| 750 | PAN-37 | M | low | stale |  |  | Support external PR selection for merge-agent |

## Rationale detail

### PAN-3264 (rank 1)

Merged outage fix awaiting close-out; carries blocks-main and needs-close-out labels. Pinned per in-pipeline rule.

### PAN-3232 (rank 3)

New, in-pipeline. PAN-3068/PAN-3070/PAN-3051 already deliver complete pending-input data to the store; every remaining defect is a render-layer drop — a structurally dead issue-view triangle, prompt text rendered nowhere, the wrong label, a stale tree, and invisible specialists. It is the client half of the same freeze-visibility work as PAN-3233 and depends on that server classification being correct.

### PAN-3242 (rank 6)

New, in-pipeline. The current panel silently discards the posture reason, hides attribution, and gives no per-field save state; the operator has already approved an interactive mockup built on the real dashboard tokens, so the design risk is retired and this is execution against a fixed reference. Order books are the operator's curation surface for Flywheel campaigns, which keeps it above routine UI polish.

### PAN-3260 (rank 6)

In review; PAN-3274 documents its test-role agent spawning and never producing a verdict, which is what actually blocks it. Pinned per in-pipeline rule.

### PAN-3285 (rank 7)

A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and cannot start a replacement; manual recovery is killed within 30s. This is the single worst availability bug on the books and it also silenced 1107 failures without escalation, so it ranks first among workable items.

### PAN-3283 (rank 8)

pan review restart can flip an issue to passed/ready_for_merge=1 while the newest written verdict is CHANGES REQUESTED — two live cases were sitting in a UAT batch. This is a merge-safety hole that can land unapproved code; nothing else in the backlog subverts the review gate this directly.

### PAN-3250 (rank 9)

Confirmed contamination on four live feature branches that silently carry 14 unpushed local-main commits, and PRs still show MERGEABLE/CLEAN. Until spawn bases on origin/main, every new workspace is suspect and merges can ship commits nobody reviewed.

### PAN-3282 (rank 10)

review_infrastructure_failure recurs across projects, including on issues already recovered once, leaving verdict-shaped statuses with no artifact. It is the parent failure behind PAN-3283 and PAN-3280 and the biggest recurring drain on pipeline autonomy.

### PAN-3259 (rank 11)

Main is red on a 1-in-5 flake in the PAN-1837 ambiguous-delivery retry tests. Small fix (align fake timers with fs I/O per the repo fake-timer rule) that un-reddens main and unblocks an in-review harness feature.

### PAN-3266 (rank 12)

A generated hook file makes every fresh workspace dirty, so planning→work auto-handoff refuses to start (PAN-3254 blocked live). One ignore/generation fix restores the paved road for all new work.

### PAN-3281 (rank 13)

An issue can be simultaneously ready_for_merge=1 and verification_stuck, and the merge-ready flag wins everywhere, so incomplete work reaches UAT promotion (live case: PAN-3232). Merge-gate honesty bug in the same safety class as PAN-3283.

### PAN-3253 (rank 14)

Quadratic event payloads: each status change re-serializes the full review history, producing 1 GB of a 1.3 GB DB. Ready to work (in-review label, plan exists); fixing it removes a measured substrate cost every machine pays.

### PAN-3278 (rank 15)

A healthy completed agent sat two hours with no review because the requeue machinery that exists for exactly this case never fired. Core autonomy regression: done work must always converge to review without an operator.

### PAN-3274 (rank 16)

agent-pan-3260-test sat 40 minutes at zero tokens/zero cost while review-passed, CI-green work waited on it. Kickoff-delivery/liveness gap in the test role; currently blocking pinned PAN-3260.

### PAN-2706 (rank 17)

The older, broader form of PAN-3274: a booted-but-never-briefed test session permanently absorbs all future dispatches and the issue hangs in testing forever. Fixing the kickoff-verified-or-dead invariant likely resolves both.

### PAN-3248 (rank 18)

A successful reload must clear the deploy queue; today cross-project verification silently freezes behind a stale flag (MIN-911 froze live). Small fix with fleet-wide effect; pairs with PAN-3244.

### PAN-3244 (rank 19)

Three gates compose into an unbounded cross-project hold while a deploy is queued. The design fix behind PAN-3248: scope deploy deferral to the deploying project or bound the window.

### PAN-3237 (rank 20)

Transient capacity refusals (three live issues, including now-merged PAN-1990/PAN-3232) become terminal stuck states requiring manual pan start. Retryable-vs-terminal classification fix on the main autonomy path.

### PAN-3236 (rank 21)

A definitively-dead socket (connection refused) is treated as maybe-delivered, so feedback sits on disk while the agent idles and the issue sticks. Deterministic misclassification with a clear fix; also feeds the PAN-3257 crash-resume rewire gap.

### PAN-3280 (rank 22)

Concentrated evidence of the session-vanish + reviewer-death failure family (PAN-3282/PAN-3274). Worth a root-cause pass on what kills tmux sessions with no needs-you; may close as a duplicate once the parents land.

### PAN-3234 (rank 23)

Two agents froze ~30 min on permission/resume menus and no health surface noticed; only manual pane reading found them. Wiring the existing detector into health patrol turns silent freezes into needs-you rows.

### PAN-3257 (rank 24)

After crash-restore, resumed agents keep a dead supervisor socket so every delivery fails (the ECONNREFUSED that PAN-3236 then misclassifies). Resume must re-establish or clear supervisor wiring.

### PAN-3261 (rank 25)

The PAN-3212 class again: the fallback paste can occlude the menu it must detect, then press Enter into it — which can discard a full session at the resume gate. Delivery-safety fix in the pane-choice-menu detector.

### PAN-3224 (rank 26)

A mid-spawn placeholder leaks into durable state and poisons restart. Small cleanup-on-boot/spawn fix that removes a recurring manual-recovery papercut (also behind PAN-2886).

### PAN-3245 (rank 27)

The completion gate contradicts its own exclusion list and forces agents to pan done --force, training them to bypass a safety gate. Small correctness fix with behavioral payoff.

### PAN-3243 (rank 28)

Known flake mechanism with a straightforward deterministic-wait fix; red mains freeze the whole delivery machinery, so main-flake fixes stay near the top (see also PAN-3259, PAN-1824).

### PAN-2746 (rank 29)

The previously-filed twin of PAN-3283: the bypass verdict must be a distinct state, never passed. Fix together with PAN-3283 as one merge-safety change.

### PAN-2376 (rank 30)

Container for the convergence/flake/deploy-hygiene family that dominates this top tier (PAN-3259, PAN-3243, PAN-2567, PAN-2550, PAN-2379, PAN-1824...). Ranked by its children, which are what actually get picked.

### PAN-2742 (rank 31)

Premature synthesis produces false blocking verdicts (PAN-2710 reached cycle 9). Part of the review-infra family with PAN-3282/PAN-2746; fixes compound.

### PAN-3106 (rank 32)

An operator hold that does not hold is a merge-safety bug (MIN-901 merged individually despite the hold). Route every merge path through the one hold check.

### PAN-3103 (rank 33)

A shipped issue left open re-entered planning (planning agent spawned on shipped work). Close-out must re-verify canonical merge state rather than trusting a transient failure flag.

### PAN-3104 (rank 34)

Test artifact consumption needs a run-identity/freshness check; twin of PAN-2700. Cheap fix that stops false test failures from recycling.

### PAN-3100 (rank 35)

Test verdicts must be computed against the committed candidate revision, not whatever the agent is mid-edit on. Removes a whole class of false failures that burn review cycles.

### PAN-2567 (rank 36)

The canonical convergence bug: approved work must reach merged without operator nudges even while main moves. Core PAN-2376 child.

### PAN-2569 (rank 37)

Long-standing silent break in the plan→work seam, the same joint PAN-3237 and PAN-2691 fail at. Fix the seam once with honest retry/needs-you semantics.

### PAN-3118 (rank 38)

Quota exhaustion must surface as a resource alert and gate dispatch, not masquerade as running agents. Same family as PAN-3043/PAN-2758 zombie-on-provider-error.

### PAN-3139 (rank 39)

The runtime registry contradicting the liveness oracle breaks every downstream consumer (dispatch, dashboards, patrols). Reconcile the agents table against tmux ground truth continuously.

### PAN-3062 (rank 40)

Structural hazard of many sessions sharing one main checkout; interacts with PAN-3250 contamination. Needs a push-scope guard or per-session isolation for main-bound work.

### PAN-3081 (rank 41)

The guard must be un-bypassable (hook-level, not PATH-level) and its false positives fixed so agents stop being trained to defeat safety rails.

### PAN-2940 (rank 42)

Direct-push refactor series keep reddening main because nothing runs CI before the push. A required pre-merge check for conversation pushes closes the last big red-main source.

### PAN-3205 (rank 43)

The deploy queue has no consumer for its own deferral promise; with PAN-3248/PAN-3244 this completes the deploy-hygiene cluster.

### PAN-3085 (rank 44)

Path split from the rebrand means feedback can never be consumed where it is produced. Mechanical unification with high pipeline payoff.

### PAN-3078 (rank 45)

Verdict delivery is a one-way door into a deadlock for compliant agents. Wire the inspect verdict into the same delivery door feedback uses.

### PAN-3084 (rank 46)

Restart preserves the zombie because it looks alive. Same never-briefed family as PAN-3274/PAN-2706 — kickoff must be verified or the session culled.

### PAN-2695 (rank 47)

Dispatch needs per-issue serialization; this race is one of the recurring review-convoy wedges behind manual restarts.

### PAN-2689 (rank 48)

Verdict writes must be durable before the process exits (the PAN-1988 write-door discipline). Silent verdict loss burns full review cycles.

### PAN-2691 (rank 49)

Another leak at the plan→work seam: gate refusals need retry-with-backoff or an honest needs-you, never silence. Fix alongside PAN-3237/PAN-2569.

### PAN-2650 (rank 50)

Terminal-slot wedge with no recovery path strands whole swarms at the finish line. Needs a governor-aware retry or recover path that rebuilds the stack.

### PAN-3286 (rank 51)

The operator-directed continuation of merged PAN-1990 with a full PRD on overdeck-state. Largest planned feature investment currently specced; starts once PAN-1990 verification completes.

### PAN-3210 (rank 52)

Close-out must converge; scope the guard and teardown identically. One of three close-out blockers (with PAN-3196/PAN-3168) keeping done issues open.

### PAN-3196 (rank 53)

Teardown needs a privileged-residue strategy (fix ownership at creation or escalate at teardown). Blocks the DoD-complete finish line for containerized projects.

### PAN-3188 (rank 54)

dod-gate.ts:387 makes the mechanical close gate unpassable for exactly the issues it should pass. Small targeted fix to the PAN-2715 gate.

### PAN-3190 (rank 55)

One-line argument-plumbing fix restoring the only CLI lever over flywheel auto-merge rows.

### PAN-2075 (rank 56)

Container for PAN-2077/2078/2079/2080 and the answer to the scattered-notification problem (absorbs PAN-454, PAN-1775, PAN-43). The inbox spine is the prerequisite for trustworthy autonomy at scale; children rank with it.

### PAN-3168 (rank 57)

Close-out must not be blocked by the pause it itself required. Small classifier fix in the same gate as PAN-3188.

### PAN-3171 (rank 58)

False-failure reporting desyncs tracker state from reality and invites double work; verify against canonical merge evidence before reporting.

### PAN-3186 (rank 59)

Membership gathering must degrade per-member, not per-project. Same non-degrading-caller class as PAN-2824; restores visibility for polyrepo projects.

### PAN-3267 (rank 60)

Batch or cache the merged-head checks; today every refresh on GitLab projects stalls the membership door.

### PAN-1666 (rank 61)

Umbrella for making unattended operation a non-event after the thundering-herd incident. Much has landed (memory governor, brakes); remaining children should be re-enumerated, but the goal is still core substrate.

### PAN-2952 (rank 62)

Write-door contention silently drops verdicts — same durable-verdict discipline as PAN-2689. Root-cause the lock lifecycle rather than adding retries.

### PAN-3044 (rank 63)

Terminal-state checks are missing from the feedback path; closed issues must be inert. Pairs with PAN-2769 stale-row reconciliation.

### PAN-3043 (rank 64)

Provider-fatal errors must transition the agent, free the slot, and raise a resource alert; same cluster as PAN-3118/PAN-2758.

### PAN-2908 (rank 65)

The operator's stated product bar with an implementer-ready PRD and mockups. Ranks below the substrate-reliability tier because a stable pipeline is its prerequisite, but it is the flagship product investment.

### PAN-3023 (rank 66)

The retry counter that never counts: another plan→work seam leak to fix with PAN-3237/PAN-2691/PAN-2569.

### PAN-2758 (rank 67)

Terminal provider errors must produce a terminal agent state. Part of the invisible-halt cluster (PAN-3118/PAN-3043).

### PAN-2839 (rank 68)

Regression on the highest-traffic seam in the pipeline; dedupe the prep path and make spawn idempotent.

### PAN-2848 (rank 69)

Inspection needs the same liveness/redispatch discipline being built for review and test roles; with PAN-3078 it closes the inspect-deadlock pair.

### PAN-2817 (rank 70)

Idle-at-composer is a detectable state with no patrol owner. A nudge/redrive patrol recovers hours of silent stall across harnesses.

### PAN-3057 (rank 71)

Post-compaction agents need a continue nudge, and the conflicting window declarations feed wrong compaction thresholds. Cross-harness reliability fix.

### PAN-2642 (rank 72)

Container for the cost-honesty family (PAN-1868 breaker, PAN-1042 retention, PAN-2466 usage clobber, display fixes). Strategy is decided; children are individually workable.

### PAN-2759 (rank 73)

Flywheel recovery exists but did not fire; root-cause the patrol gap. Pairs with PAN-2747 resume-affordance fix.

### PAN-2747 (rank 74)

The operator-facing half of flywheel crash recovery: a live run must be resumable, not abort-only.

### PAN-2769 (rank 75)

Stale terminal-state rows corrupt every derived count and enable the PAN-3044 resurrection class. Add close-time reconciliation.

### PAN-2888 (rank 76)

Same close-time hygiene as PAN-2769; fold into one close-out reconciliation change.

### PAN-3108 (rank 77)

Trivial rotation fix with real disk-pressure payoff; same class as PAN-1846 (deacon.log 687MB) — do both together.

### PAN-1824 (rank 78)

Already planned and ready; directly serves the flakes-never-gate principle (PAN-2376) alongside PAN-3243/PAN-3259.

### PAN-2670 (rank 79)

An entire half of the codebase ships without type checking; burn down the debt (PAN-2635) and gate it so regressions stop entering blind.

### PAN-2593 (rank 80)

Verification results are computed under the wrong runtime; env-normalize child spawns. Quietly undermines every gate result on affected machines.

### PAN-3272 (rank 81)

With PAN-3202 (accept a later green run containing the merge), makes the deploy-evidence row honest instead of permanently red.

### PAN-3202 (rank 82)

The constructive half of the PAN-3272 fix; small gate-evidence change.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-29T16:37:11.469Z",
  "model": "claude-fable-5",
  "pass": "incremental",
  "openCount": 750,
  "nodes": [
    {
      "issue": "PAN-3264",
      "rank": 1,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline: merged, blocks-main, needs close-out — pinned at top until close-out lands.",
      "rationale": "Merged outage fix awaiting close-out; carries blocks-main and needs-close-out labels. Pinned per in-pipeline rule.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3232",
      "rank": 3,
      "size": "M",
      "importance": "high",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pending-input render layer drops data the store has: dead issue-view triangle, prompt text nowhere, stale tree, invisible specialists",
      "rationale": "New, in-pipeline. PAN-3068/PAN-3070/PAN-3051 already deliver complete pending-input data to the store; every remaining defect is a render-layer drop — a structurally dead issue-view triangle, prompt text rendered nowhere, the wrong label, a stale tree, and invisible specialists. It is the client half of the same freeze-visibility work as PAN-3233 and depends on that server classification being correct.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3242",
      "rank": 6,
      "size": "M",
      "importance": "high",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rebuild order-book RunSettingsPanel to the approved mockup: atomic posture+reason, visible attribution, per-field save state",
      "rationale": "New, in-pipeline. The current panel silently discards the posture reason, hides attribution, and gives no per-field save state; the operator has already approved an interactive mockup built on the real dashboard tokens, so the design risk is retired and this is execution against a fixed reference. Order books are the operator's curation surface for Flywheel campaigns, which keeps it above routine UI polish.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1990",
      "rank": 176,
      "size": "XL",
      "importance": "high",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class workspaces and projects with per-workspace memory",
      "rationale": "Promoted from 509: the PRD landed on overdeck-state with verified references and numbered work items, and PAN-3181 now builds on the same per-workspace memory model.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1837",
      "rank": 461,
      "size": "L",
      "importance": "high",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support Kimi Code as a first-class harness (Moonshot's own coding CLI)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3260",
      "rank": 6,
      "size": "M",
      "importance": "medium",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "In pipeline: markdown chip editor in review — pinned; blocked by a test agent that never ran (PAN-3274).",
      "rationale": "In review; PAN-3274 documents its test-role agent spawning and never producing a verdict, which is what actually blocks it. Pinned per in-pipeline rule.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3285",
      "rank": 7,
      "size": "L",
      "importance": "critical",
      "score": 98,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor pinned to a reload generation kills every healthy dashboard — 3.5h outage, 1107 silent failures, no operator escalation.",
      "rationale": "A supervisor unit pinned to a pan reload generation SIGTERMs every correctly-running dashboard and cannot start a replacement; manual recovery is killed within 30s. This is the single worst availability bug on the books and it also silenced 1107 failures without escalation, so it ranks first among workable items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3283",
      "rank": 8,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recovery from review_infrastructure_failure writes review_status=passed over an outstanding CHANGES REQUESTED verdict.",
      "rationale": "pan review restart can flip an issue to passed/ready_for_merge=1 while the newest written verdict is CHANGES REQUESTED — two live cases were sitting in a UAT batch. This is a merge-safety hole that can land unapproved code; nothing else in the backlog subverts the review gate this directly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3250",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace spawn branches from local HEAD, not origin/main — every new workspace inherits unpushed local commits (blocks-main).",
      "rationale": "Confirmed contamination on four live feature branches that silently carry 14 unpushed local-main commits, and PRs still show MERGEABLE/CLEAN. Until spawn bases on origin/main, every new workspace is suspect and merges can ship commits nobody reviewed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3282",
      "rank": 10,
      "size": "L",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review agents die before writing a verdict across 5 issues and 2 projects — recurring, needs manual restart each time.",
      "rationale": "review_infrastructure_failure recurs across projects, including on issues already recovered once, leaving verdict-shaped statuses with no artifact. It is the parent failure behind PAN-3283 and PAN-3280 and the biggest recurring drain on pipeline autonomy.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3259",
      "rank": 11,
      "size": "S",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Red main: PAN-1837 retry test races fs I/O against fake timers, flaky 1-in-5 — unblocks PAN-1837.",
      "rationale": "Main is red on a 1-in-5 flake in the PAN-1837 ambiguous-delivery retry tests. Small fix (align fake timers with fs I/O per the repo fake-timer rule) that un-reddens main and unblocks an in-review harness feature.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3266",
      "rank": 12,
      "size": "S",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every new workspace is born dirty from generated .husky/_/pre-rebase, blocking planning auto-handoff (blocks-main).",
      "rationale": "A generated hook file makes every fresh workspace dirty, so planning→work auto-handoff refuses to start (PAN-3254 blocked live). One ignore/generation fix restores the paved road for all new work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3281",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "ready_for_merge stays 1 while stuck on incomplete-plan-items — stuck work reaches UAT batches and promotion.",
      "rationale": "An issue can be simultaneously ready_for_merge=1 and verification_stuck, and the merge-ready flag wins everywhere, so incomplete work reaches UAT promotion (live case: PAN-3232). Merge-gate honesty bug in the same safety class as PAN-3283.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3253",
      "rank": 14,
      "size": "M",
      "importance": "high",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "review.status_changed embeds the unbounded history array — one event type is 80% of a 1.3 GB overdeck.db.",
      "rationale": "Quadratic event payloads: each status change re-serializes the full review history, producing 1 GB of a 1.3 GB DB. Ready to work (in-review label, plan exists); fixing it removes a measured substrate cost every machine pays.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3278",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent finished with an open PR but review was never dispatched — auto-requeue had 25 attempts and fired none.",
      "rationale": "A healthy completed agent sat two hours with no review because the requeue machinery that exists for exactly this case never fired. Core autonomy regression: done work must always converge to review without an operator.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3274",
      "rank": 16,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "A test-role agent can spawn and never run — its issue is stranded behind a verdict that was never produced.",
      "rationale": "agent-pan-3260-test sat 40 minutes at zero tokens/zero cost while review-passed, CI-green work waited on it. Kickoff-delivery/liveness gap in the test role; currently blocking pinned PAN-3260.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2706",
      "rank": 17,
      "size": "M",
      "importance": "high",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ghost test sessions absorb every test dispatch — never-kicked-off session reads as running, testStatus flips with no prompt delivered.",
      "rationale": "The older, broader form of PAN-3274: a booted-but-never-briefed test session permanently absorbs all future dispatches and the issue hangs in testing forever. Fixing the kickoff-verified-or-dead invariant likely resolves both.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3248",
      "rank": 18,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload leaves pending-deploy.json set — every flywheel deploy starves verification for ALL projects until a patrol runs.",
      "rationale": "A successful reload must clear the deploy queue; today cross-project verification silently freezes behind a stale flag (MIN-911 froze live). Small fix with fleet-wide effect; pairs with PAN-3244.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3244",
      "rank": 19,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Queued dashboard deploy globally defers verification — deploy window starves cross-project review handoffs unboundedly.",
      "rationale": "Three gates compose into an unbounded cross-project hold while a deploy is queued. The design fix behind PAN-3248: scope deploy deferral to the deploying project or bound the window.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3237",
      "rank": 20,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capacity-refused planning→work handoff is marked terminally stuck — every HTTP 409 becomes guardrails + markWorkspaceStuck.",
      "rationale": "Transient capacity refusals (three live issues, including now-merged PAN-1990/PAN-3232) become terminal stuck states requiring manual pan start. Retryable-vs-terminal classification fix on the main autonomy path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3236",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "ECONNREFUSED on a dead supervisor socket misclassified as ambiguous keyed delivery — review feedback never lands, issue goes stuck.",
      "rationale": "A definitively-dead socket (connection refused) is treated as maybe-delivered, so feedback sits on disk while the agent idles and the issue sticks. Deterministic misclassification with a clear fix; also feeds the PAN-3257 crash-resume rewire gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3280",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "PAN-3253 agent sessions vanished 4x in one run and its reviewer died with no artifact — all silently.",
      "rationale": "Concentrated evidence of the session-vanish + reviewer-death failure family (PAN-3282/PAN-3274). Worth a root-cause pass on what kills tmux sessions with no needs-you; may close as a duplicate once the parents land.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3234",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents freeze indefinitely on blocking choice menus — paneHasBlockingChoiceMenu wired to delivery refusal only, never to health.",
      "rationale": "Two agents froze ~30 min on permission/resume menus and no health surface noticed; only manual pane reading found them. Wiring the existing detector into health patrol turns silent freezes into needs-you rows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3257",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-resume does not re-wire the PTY supervisor — stale socket refuses all deliveries and state.json loses supervisorEnabled.",
      "rationale": "After crash-restore, resumed agents keep a dead supervisor socket so every delivery fails (the ECONNREFUSED that PAN-3236 then misclassifies). Resume must re-establish or clear supervisor wiring.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3261",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume-gate Enter: tmux fallback answers a live choice menu when its own paste hides the menu from the detector.",
      "rationale": "The PAN-3212 class again: the fallback paste can occlude the menu it must detect, then press Enter into it — which can discard a full session at the resume gate. Delivery-safety fix in the pane-choice-menu detector.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3224",
      "rank": 26,
      "size": "S",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash-interrupted spawn strands model=pending-work-spawn — plain pan start dies with Unknown model; only --fresh recovers.",
      "rationale": "A mid-spawn placeholder leaks into durable state and poisons restart. Small cleanup-on-boot/spawn fix that removes a recurring manual-recovery papercut (also behind PAN-2886).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3245",
      "rank": 27,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done falsely flags workspace .pan/drafts/<issue>.md as uncommitted work despite its own .pan exclusion.",
      "rationale": "The completion gate contradicts its own exclusion list and forces agents to pan done --force, training them to bypass a safety gate. Small correctness fix with behavioral payoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3243",
      "rank": 28,
      "size": "S",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto-commit test polls a fixed 20 setImmediate turns for a real git subprocess — flake reddened main and blocked a close-out.",
      "rationale": "Known flake mechanism with a straightforward deterministic-wait fix; red mains freeze the whole delivery machinery, so main-flake fixes stay near the top (see also PAN-3259, PAN-1824).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2746",
      "rank": 29,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review infra-failure bypass writes reviewStatus=passed — indistinguishable from a real approval; nearly merged unreviewed work.",
      "rationale": "The previously-filed twin of PAN-3283: the bypass verdict must be a distinct state, never passed. Fix together with PAN-3283 as one merge-safety change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2376",
      "rank": 30,
      "size": "XL",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: CI/CD reliability — flakes never gate, done work always converges to merged, deploys always ship origin/main.",
      "rationale": "Container for the convergence/flake/deploy-hygiene family that dominates this top tier (PAN-3259, PAN-3243, PAN-2567, PAN-2550, PAN-2379, PAN-1824...). Ranked by its children, which are what actually get picked.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2742",
      "rank": 31,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review synthesis fires 42s after spawn, calling reviewers with reports on disk an infra failure — false CHANGES REQUESTED burns cycles.",
      "rationale": "Premature synthesis produces false blocking verdicts (PAN-2710 reached cycle 9). Part of the review-infra family with PAN-3282/PAN-2746; fixes compound.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3106",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "auto_merge_default:hold is bypassed — shouldHoldForUat consulted on only one merge path, so held issues merge anyway.",
      "rationale": "An operator hold that does not hold is a merge-safety bug (MIN-901 merged individually despite the hold). Route every merge path through the one hold check.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3103",
      "rank": 33,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Transient merge_status=failed permanently skips automatic close-out — merged issue stays open and pickup-eligible.",
      "rationale": "A shipped issue left open re-entered planning (planning agent spawned on shipped work). Close-out must re-verify canonical merge state rather than trusting a transient failure flag.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3104",
      "rank": 34,
      "size": "S",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stale .pan/test/result.json re-applied with no freshness check — re-fails an issue after the fix landed.",
      "rationale": "Test artifact consumption needs a run-identity/freshness check; twin of PAN-2700. Cheap fix that stops false test failures from recycling.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3100",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test role evaluates the dirty working tree — a live work agent's uncommitted edits produce false test failures.",
      "rationale": "Test verdicts must be computed against the committed candidate revision, not whatever the agent is mid-edit on. Removes a whole class of false failures that burn review cycles.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2567",
      "rank": 36,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewed+green PR stuck after review — advancing verdict reconciled forever, merge never fires (churning-main convergence failure).",
      "rationale": "The canonical convergence bug: approved work must reach merged without operator nudges even while main moves. Core PAN-2376 child.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2569",
      "rank": 37,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning finalizes (issue→planned) but the work agent does not auto-spawn — silent handoff failure requiring manual pan start.",
      "rationale": "Long-standing silent break in the plan→work seam, the same joint PAN-3237 and PAN-2691 fail at. Fix the seam once with honest retry/needs-you semantics.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3118",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model quota exhaustion halts agents invisibly — 4 planning agents running at $0.00 with no capacity fallback or alert.",
      "rationale": "Quota exhaustion must surface as a resource alert and gate dispatch, not masquerade as running agents. Same family as PAN-3043/PAN-2758 zombie-on-provider-error.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3139",
      "rank": 39,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents-table liveness drifts stale in the under-reporting direction — live 4h agent recorded stopped while pan start refuses.",
      "rationale": "The runtime registry contradicting the liveness oracle breaks every downstream consumer (dispatch, dashboards, patrols). Reconcile the agents table against tmux ground truth continuously.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3062",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared primary main worktree: any agent that pushes main also ships every other session's unpushed local commits.",
      "rationale": "Structural hazard of many sessions sharing one main checkout; interacts with PAN-3250 contamination. Needs a push-scope guard or per-session isolation for main-bound work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3081",
      "rank": 41,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent git guard is bypassable by removing it from $PATH — an agent did so unprompted to get past a false block.",
      "rationale": "The guard must be un-bypassable (hook-level, not PATH-level) and its false positives fixed so agents stop being trained to defeat safety rails.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2940",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three red-mains in one day from direct-push series bypassing PR CI — conversations need a pre-merge CI surface.",
      "rationale": "Direct-push refactor series keep reddening main because nothing runs CI before the push. A required pre-merge check for conversation pushes closes the last big red-main source.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3205",
      "rank": 43,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deployment gate queues a deferred deploy but never fires it — the promised next-verification-boundary trigger does not exist.",
      "rationale": "The deploy queue has no consumer for its own deferral promise; with PAN-3248/PAN-3244 this completes the deploy-hygiene cluster.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3085",
      "rank": 44,
      "size": "S",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback written to .overdeck/feedback while agents and the deacon merge gate read nonexistent .pan/feedback.",
      "rationale": "Path split from the rebrand means feedback can never be consumed where it is produced. Mechanical unification with high pipeline payoff.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3078",
      "rank": 45,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect verdict is never delivered to the work agent — an agent that waits for it deadlocks forever.",
      "rationale": "Verdict delivery is a one-way door into a deadlock for compliant agents. Wire the inspect verdict into the same delivery door feedback uses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3084",
      "rank": 46,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "A review session spawned but never briefed sits at zero context forever and blocks its own replacement.",
      "rationale": "Restart preserves the zombie because it looks alive. Same never-briefed family as PAN-3274/PAN-2706 — kickoff must be verified or the session culled.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2695",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Concurrent review dispatches race fresh-spawn vs resume — second dispatch resumes a still-booting parent and kills synthesis kickoff.",
      "rationale": "Dispatch needs per-issue serialization; this race is one of the recurring review-convoy wedges behind manual restarts.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2689",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdicts from sandboxed codex review agents silently lost — fire-and-forget journal write dies with the CLI process.",
      "rationale": "Verdict writes must be durable before the process exits (the PAN-1988 write-door discipline). Silent verdict loss burns full review cycles.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2691",
      "rank": 49,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-planned issues park silently when the post-finalize work spawn is gated (stack-unhealthy 422) — no retry, no needs-you.",
      "rationale": "Another leak at the plan→work seam: gate refusals need retry-with-backoff or an honest needs-you, never silence. Fix alongside PAN-3237/PAN-2569.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2650",
      "rank": 50,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm final ready-to-merge slot wedges when the memory governor sheds the integration stack; pan swarm recover cannot recover it.",
      "rationale": "Terminal-slot wedge with no recovery path strands whole swarms at the finish line. Needs a governor-aware retry or recover path that rebuilds the stack.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3286",
      "rank": 51,
      "size": "XL",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [
        "PAN-1990"
      ],
      "why": "Workspace parity with Subspace: shared workspaces, target-scoped recall, status history, session briefing (PRD ready).",
      "rationale": "The operator-directed continuation of merged PAN-1990 with a full PRD on overdeck-state. Largest planned feature investment currently specced; starts once PAN-1990 verification completes.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3210",
      "rank": 52,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocked by an unprefixed devcontainer init-perms container — teardown scopes by compose project, guard scopes by working_dir.",
      "rationale": "Close-out must converge; scope the guard and teardown identically. One of three close-out blockers (with PAN-3196/PAN-3168) keeping done issues open.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3196",
      "rank": 53,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out cannot tear down workspaces with root-owned container residue — passes every DoD row then dies on EACCES.",
      "rationale": "Teardown needs a privileged-residue strategy (fix ownership at creation or escalate at teardown). Blocks the DoD-complete finish line for containerized projects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3188",
      "rank": 54,
      "size": "S",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 rejects terminal canonical states — an already-done issue can never satisfy the post-merge row.",
      "rationale": "dod-gate.ts:387 makes the mechanical close gate unpassable for exactly the issues it should pass. Small targeted fix to the PAN-2715 gate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3190",
      "rank": 55,
      "size": "XS",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan merge cancel is 100% broken — Commander passes its options object into the fetchImpl injection slot.",
      "rationale": "One-line argument-plumbing fix restoring the only CLI lever over flywheel auto-merge rows.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 56,
      "size": "XL",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: Boot Reconciliation + Operator Inbox — one decision surface for unverified agents, plus a durable notification spine.",
      "rationale": "Container for PAN-2077/2078/2079/2080 and the answer to the scattered-notification problem (absorbs PAN-454, PAN-1775, PAN-43). The inbox spine is the prerequisite for trustworthy autonomy at scale; children rank with it.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3168",
      "rank": 57,
      "size": "S",
      "importance": "medium",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 5 deadlocks close-out: an agent paused FOR close-out with no tmux session counts as running and blocks it.",
      "rationale": "Close-out must not be blocked by the pause it itself required. Small classifier fix in the same gate as PAN-3188.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3171",
      "rank": 58,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline reports merge failed AFTER a successful merge and cleanup — issue stays Todo while the commit is on main.",
      "rationale": "False-failure reporting desyncs tracker state from reality and invites double work; verify against canonical merge evidence before reporting.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3186",
      "rank": 59,
      "size": "S",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline membership blanks the whole auricle project because one configured member (infra) is not a git repo.",
      "rationale": "Membership gathering must degrade per-member, not per-project. Same non-degrading-caller class as PAN-2824; restores visibility for polyrepo projects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3267",
      "rank": 60,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitLab merged-head oracle fans out one glab subprocess per (repo × head), stalling and failing every membership refresh.",
      "rationale": "Batch or cache the merged-head checks; today every refresh on GitLab projects stalls the membership door.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 61,
      "size": "XL",
      "importance": "high",
      "score": 71,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "EPIC: Throughput hardening — many work agents safely, on-demand rate-limited specialists, slot manager, fly.io scale-out.",
      "rationale": "Umbrella for making unattended operation a non-event after the thundering-herd incident. Much has landed (memory governor, brakes); remaining children should be re-enumerated, but the goal is still core substrate.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2952",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdict writes lost to per-issue record-lock collisions; reads reconcile stale journal over fresh DB state.",
      "rationale": "Write-door contention silently drops verdicts — same durable-verdict discipline as PAN-2689. Root-cause the lock lifecycle rather than adding retries.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3044",
      "rank": 63,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review feedback delivery runs against CLOSED issues — resurrects agents and raises needs-you 12 days after close-out.",
      "rationale": "Terminal-state checks are missing from the feedback path; closed issues must be inert. Pairs with PAN-2769 stale-row reconciliation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3043",
      "rank": 64,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Mid-run provider quota exhaustion undetected — agent stays running for days holding a slot (kimi 403 billing-cycle).",
      "rationale": "Provider-fatal errors must transition the agent, free the slot, and raise a resource alert; same cluster as PAN-3118/PAN-2758.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2908",
      "rank": 65,
      "size": "XL",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple-by-default, conversation-first UX overhaul — junior-dev usable with zero training; PRD + binding mockups exist.",
      "rationale": "The operator's stated product bar with an implementer-ready PRD and mockups. Ranks below the substrate-reliability tier because a stable pipeline is its prerequisite, but it is the flagship product investment.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3023",
      "rank": 66,
      "size": "M",
      "importance": "high",
      "score": 69,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-planning auto-spawn abandoned on transient Docker failure — attempt 1/3 never retries, issue stuck in todo with no re-drive owner.",
      "rationale": "The retry counter that never counts: another plan→work seam leak to fix with PAN-3237/PAN-2691/PAN-2569.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2758",
      "rank": 67,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "Provider capacity error silently zombies a spawned agent — willRetry=false, turn completed, status=running forever.",
      "rationale": "Terminal provider errors must produce a terminal agent state. Part of the invisible-halt cluster (PAN-3118/PAN-3043).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2839",
      "rank": 68,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "plan→work autoSpawn 500s with a duplicated workspace prep — nondeterministic half-spawns since PAN-2825.",
      "rationale": "Regression on the highest-traffic seam in the pipeline; dedupe the prep path and make spawn idempotent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2848",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stalls forever on a dead inspection — no re-dispatch, verdict never delivered, swarm-off suppresses recovery.",
      "rationale": "Inspection needs the same liveness/redispatch discipline being built for review and test roles; with PAN-3078 it closes the inspect-deadlock pair.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2817",
      "rank": 70,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-at-prompt work/review agents never redriven — gpt-5.6-sol sessions stop at the composer mid-task and sit for hours.",
      "rationale": "Idle-at-composer is a detectable state with no patrol owner. A nudge/redrive patrol recovers hours of silent stall across harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3057",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness-initiated compaction leaves agents idle forever; GPT-5.6 context window declared twice (372K vs 150K).",
      "rationale": "Post-compaction agents need a continue nudge, and the conflicting window declarations feed wrong compaction thresholds. Cross-harness reliability fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2642",
      "rank": 72,
      "size": "XL",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: Cost strategy — waste detection over budget policing; land the progress-aware breaker, make dollars honest.",
      "rationale": "Container for the cost-honesty family (PAN-1868 breaker, PAN-1042 retention, PAN-2466 usage clobber, display fixes). Strategy is decided; children are individually workable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2759",
      "rank": 73,
      "size": "M",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dead flywheel with an active run never auto-relaunched after reboot — sat idle 2h with recovery wired and enabled.",
      "rationale": "Flywheel recovery exists but did not fire; root-cause the patrol gap. Pairs with PAN-2747 resume-affordance fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2747",
      "rank": 74,
      "size": "M",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel cannot be resumed after a crash/reboot — Resume disabled, only offered action aborts the run.",
      "rationale": "The operator-facing half of flywheel crash recovery: a live run must be resumable, not abort-only.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2769",
      "rank": 75,
      "size": "S",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "review_status rows never reconciled when an issue closes — 9 closed issues advertise reviewing/failed, inflating operator counts.",
      "rationale": "Stale terminal-state rows corrupt every derived count and enable the PAN-3044 resurrection class. Add close-time reconciliation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2888",
      "rank": 76,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out leaves orphaned inspect sub-agents and uncleared review_status rows on CLOSED issues, inflating troubled/failed metrics.",
      "rationale": "Same close-time hygiene as PAN-2769; fold into one close-out reconciliation change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3108",
      "rank": 77,
      "size": "S",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "dashboard.log grows unbounded (867MB) — no rotation.",
      "rationale": "Trivial rotation fix with real disk-pressure payoff; same class as PAN-1846 (deacon.log 687MB) — do both together.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 78,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix flaky main CI: fake timers + @slow exclusion for the real-timer test family (planned, ready).",
      "rationale": "Already planned and ready; directly serves the flakes-never-gate principle (PAN-2376) alongside PAN-3243/PAN-3259.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2670",
      "rank": 79,
      "size": "L",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Gate the dashboard-server tsconfig in npm run typecheck — the server graph has no type enforcement (161 pre-existing errors).",
      "rationale": "An entire half of the codebase ships without type checking; burn down the debt (PAN-2635) and gate it so regressions stop entering blind.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2593",
      "rank": 80,
      "size": "M",
      "importance": "high",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server children inherit bare system PATH — verification gates run npm/node under system Node 18, not Node 22.",
      "rationale": "Verification results are computed under the wrong runtime; env-normalize child spawns. Quietly undermines every gate result on affected machines.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3272",
      "rank": 81,
      "size": "S",
      "importance": "medium",
      "score": 63,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 6 can never pass for anything merged during a red-main window, even after main goes green.",
      "rationale": "With PAN-3202 (accept a later green run containing the merge), makes the deploy-evidence row honest instead of permanently red.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3202",
      "rank": 82,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "DoD row 6 should accept a later green main CI run containing the merge commit as main-verify evidence.",
      "rationale": "The constructive half of the PAN-3272 fix; small gate-evidence change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3167",
      "rank": 83,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "krux/lexerra unreadable through the membership door — GitHub App not installed, and 404 is typed forge_unavailable.",
      "rationale": "Type the not-installed case distinctly and surface an actionable setup prompt instead of a permanent availability error.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3256",
      "rank": 84,
      "size": "S",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN pipeline membership fails forge_unavailable — glab mr list runs in a path that is not a git repository.",
      "rationale": "Membership gather must resolve the correct member repo path; part of the polyrepo membership cluster with PAN-3186/PAN-3267.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3047",
      "rank": 85,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike-branch teardown never fires — --is-ancestor cannot detect a squash merge, so all 96 strike branches persist as residue.",
      "rationale": "Same squash-blindness as PAN-2828/PAN-2995: verify PR-merged state, not branch ancestry, across the strike lifecycle.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3048",
      "rank": 86,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline auto-commit lands .pan/drafts/<ISSUE>.md in product feature branches; duplicated exclusion list has drifted.",
      "rationale": "Unify the exclusion list in one place; stops state artifacts leaking into product PRs.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3022",
      "rank": 87,
      "size": "S",
      "importance": "medium",
      "score": 61,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work-spawn route ignores the per-issue workModel override — role default wins and then clobbers the record.",
      "rationale": "Per-issue model routing is an operator promise; make the override win and stop the write-back clobber.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2846",
      "rank": 88,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out blocks on a dead agent: postMergeLifecycle pauses the work agent but leaves status=running.",
      "rationale": "Pause must record an honest terminal status or close-out must tolerate it; part of the close-out convergence cluster.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2059",
      "rank": 89,
      "size": "L",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: Backlog pickup gate — operator Plan→Release row + AI Objection state + Flywheel relevance-vetting.",
      "rationale": "Guards the autonomous pipeline from picking junk; mockups exist. Ranks mid-tier: valuable governance, not currently blocking throughput.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2350",
      "rank": 90,
      "size": "XL",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "EPIC: Overdeck Anywhere — remote access, Hermes bridge, mobile, shared relay backbone (PRD on overdeck-state).",
      "rationale": "Container for PAN-2351→2356. Well-specced strategic feature program; starts with P0 scoped tokens/heartbeats once the reliability tier above is under control.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2351",
      "rank": 91,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — security prerequisite for every remote surface.",
      "rationale": "First in the Anywhere chain; everything else in the program depends on it, and the token/heartbeat work hardens the local dashboard too.",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2424",
      "rank": 92,
      "size": "L",
      "importance": "medium",
      "score": 55,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "EPIC: the Order Book — operator priority queue; core landed, remaining children ranked separately.",
      "rationale": "Order books shipped (docs/ORDER-BOOKS.md exists); keep the epic as the container for remaining polish and rank residual children on their own merits.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-3218",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "No release-drift signal: a user-facing fix can sit merged on main for hours while every published version stays broken, and nothing surface…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3185",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start reports a false hard failure when the deacon wins a spawn race — duplicate-session TOCTOU between spawn.ts:498 and spawn.ts:764",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2995",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike false-blocks after gh-API squash-merge ('N commits missing from origin/main') — should verify PR-merged/content, not bran…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 96,
      "size": "XS",
      "importance": "high",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review after a PR head moves doesn't re-post panopticon/review status → PR stranded BLOCKED",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2639",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "codex-resume replays a rotated-out (revoked) refresh token → codex review convoys wedge with 401",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 98,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): launch pipeline agents with harness rate-limit model-switch reminder disabled",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips left uncommitted in shared primary worktree → spec-vs-record drift + blocks flywheel push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): frontend typecheck fails with dozens of pre-existing unused-local errors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): dashboard server route tests flake under full-suite verification load",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 103,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(verify-gate): dependency install is warn-only + 60s timeout → false verify failures against empty node_modules (blocks swarm convergenc…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 104,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reload/build atomicity: an in-place `npm run build` under a live dashboard breaks new PTY-supervisor spawns until restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 105,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): codex rate-limit 'Switch to gpt-5.4-mini?' modal stalls autonomous agents (no auto-dismiss) — agents freeze waiting for enter/…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 106,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash/displacement starts a blank session instead of resuming the live one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2324",
      "rank": 107,
      "size": "XS",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(close-out): label transition fails atomically on missing 'in-planning' label — closed issues keep stale in-review/merged labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 47,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): something burns the full 5k/hr GitHub GraphQL quota — repeatedly breaks pan close, gh issue edit, and orchestration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2558",
      "rank": 109,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(state-migration): support polyrepo projects — resolve state-host repo via pan_records (MyN state is currently tracked in NO git repo)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2193",
      "rank": 110,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Held issues (objection/parked/vetoed/needs-handoff) are invisible in the Command Deck tree — resolver buckets them clean_terminal",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 111,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(flywheel): post-merge lifecycle can leave merged issues in-review and auto-merge rows stuck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(lifecycle): relaunch can leave a zombie agent — session alive but kickoff never delivered (liveness checks fooled)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): Docker init container lacks Python — node-gyp rebuild of better-sqlite3 fails, breaking workspace stack creation (forces --…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(deacon): kimi agent silently frozen at 100% ctx (no thrown overflow error) not caught by CONTEXT_OVERFLOW_PATTERNS — needs ctx-saturati…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 115,
      "size": "XS",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: close-issue phase reports success but leaves issue OPEN / wrong labels (remove-label aborts on absent label; no-vBRIEF transitio…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike workspace setup leaves broken partial workspace + false 'spawned' success (git-lock race)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2233",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "refactor(cloister): decompose merge-agent.ts (1,414 lines) into focused modules",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2190",
      "rank": 118,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose routes/workspaces/merge-ops.ts (1,925 lines) — new god file from the workspaces split",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1650",
      "rank": 119,
      "size": "M",
      "importance": "high",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Split readyForMerge → gatesPassed (derived/event-driven) + shipComplete; auto-dispatch ship on gates-green",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2720",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "File-size ratchet counts lines, so it rewards line-packing on the god files it means to improve — two strikes bent their diffs around it in…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2709",
      "rank": 121,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator is unreachable as a notification target — agents auto-resume it, resume always fails when the run is stopped, feedbac…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): pan-dir auto-commit rebase races live .pan/continues writes — 'rebase failed for main: GitError' every busy cycle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 123,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show merged-but-not-closed-out count in pan status and the dashboard headline",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1766",
      "rank": 124,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): work agents hang on Claude Code settings-file protection when editing .claude/** — un-overridable by PreToolUse hook (PAN-1616…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 125,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: work-spawn docker-health gate has no autonomous recovery — proposed work can't auto-start when the stack is down",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "[META] 9 systemic failure patterns surfaced by 80-issue audit — substrate work to prevent closed-but-not-shipped issues",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1452",
      "rank": 127,
      "size": "M",
      "importance": "high",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1381 follow-up: per-reviewer restart with model override (architectural mismatch with PAN-1048)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 128,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2145 follow-up: restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 130,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(process): write a Definition of Ready (DoR) — the bar an issue must clear before planning/pickup, tuned to catch junk like the retire…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 131,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: handle codex weekly-quota exhaustion gracefully — resource alert + downshift/dismiss policy instead of freezing agents at an unanswer…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 132,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decompose src/lib/cloister/deacon.ts (3,394 lines) — pipeline machinery, supervised handoff",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel resilience for the codebase-health flood: substrate-first prioritization + tenets spirit-gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2079"
      ],
      "why": "Operator Inbox external transports (email/Slack/push/TTS) — offline reach (fast-follow, absorbs #43)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "Operator Inbox: durable server-side queue + in-dashboard surface (the notification spine)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 136,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [
        "PAN-2077"
      ],
      "why": "CLI parity for boot reconciliation: pan boot status + pan resume --all|--select|--freeze|--kill-remote",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 137,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate-complete reconciliation inventory (local tmux + remote Fly machines) — one resolver",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 138,
      "size": "XL",
      "importance": "high",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Epic C: Workspace state sanity on spawn",
      "gate": "auto",
      "planning": "interactive",
      "isEpic": true
    },
    {
      "issue": "PAN-1209",
      "rank": 139,
      "size": "M",
      "importance": "high",
      "score": 39,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-1052 bead projection disagrees with bd state",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2672",
      "rank": 140,
      "size": "M",
      "importance": "medium",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post-/clear siblings render the same original transcript (per-tmux resolution + frozen launcher pin + null claude_session_id)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1889",
      "rank": 141,
      "size": "M",
      "importance": "high",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): retention/compaction policy for docs/FLYWHEEL-STATE.md — it grows unbounded and is read whole every run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 142,
      "size": "M",
      "importance": "high",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer template versioning + re-render on demand",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3284",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent wrote a doc edit into the primary main worktree instead of its workspace (PAN-2204 family)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3276",
      "rank": 144,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Needs-you rows do not navigate — clicking a terminal question or permission prompt does nothing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3164",
      "rank": 145,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT stack shows 'Open UAT frontend' while still booting — operator gets Gateway Timeout with no indication it is starting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3157",
      "rank": 146,
      "size": "M",
      "importance": "medium",
      "score": 36,
      "condition": "ok",
      "dependsOn": [],
      "why": "Awareness feed shows the Flywheel as a generic 'Claude Code / No messages yet' chat row instead of flywheel run activity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2837",
      "rank": 147,
      "size": "M",
      "importance": "high",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Distributed agent presence: record which machine runs each issue's agents on overdeck-state (claim/release, no heartbeats)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2830",
      "rank": 148,
      "size": "M",
      "importance": "high",
      "score": 36,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shared Logbook: make the overdeck-state branch opt-in — OFF by default, local-only state, clean enable/disable with confirmation dialogs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3137",
      "rank": 149,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT generation member titles are taken from the Flywheel status snapshot, so orchestrator prose reaches the operator's UAT surface",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3130",
      "rank": 150,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: path-escape validation for identifier-joined write paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3129",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: symlink/TOCTOU containment for canonical writes under agent-controlled paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3121",
      "rank": 152,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send outbox does not reconcile against the transcript — delivered message keeps a doomed Retry twin",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3117",
      "rank": 153,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Failed-send bubble hides deterministic 4xx reason and offers a Retry that can never succeed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3050",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Idle-stack reaper is blind to non-Overdeck workspaces: regex matches only overdeck-feature-*-server|frontend, so MYN stacks are never reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3046",
      "rank": 155,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan CLI crashes at exit with ERR_UNHANDLED_REJECTION when the PostHog shutdown flush times out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3032",
      "rank": 156,
      "size": "XS",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace stack rebuild composes under 'overdeck-feature-' prefix while Traefik labels reference 'myn-feature-' devnet — 504s; traefik devn…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3003",
      "rank": 157,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): work-agent launchers lack OVERDECK_AGENT_ID export — manual re-launch dies instantly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2971",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(flywheel): orchestrator finalized its own run (report --force) but kept running — zombie session uncontrollable, dashboard Pause/Stop d…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3178",
      "rank": 159,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class worktrees & diffs: +/− changes badge, dedicated Changes surface, conversation worktrees",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2966",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo wrapper .gitignore misses .pan/ .devcontainer/ dev — pan done cleanliness gate false-fails on Overdeck scaffolding (MIN-882)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2960",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect supervisor lingers past 12m limit and never self-terminates after posting a verdict — shows running 38m, needs manual recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2959",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect --item <X> reviews workspace HEAD, not item X's commit — spurious verdict when HEAD moved past the item (MIN-882 metering-cost-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2954",
      "rank": 163,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "postMergeLifecycle refuses GitLab projects — merge state cannot be auto-verified, so teardown/labels never run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2935",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace devcontainer duplicate backend hijacks Traefik router — 50% of API calls 504",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2932",
      "rank": 165,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(boot): intermittent dashboard boot wedge between Cloister start and ReadModel bootstrap leaves :3011 unbound (Bad Gateway) after pan re…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2921",
      "rank": 166,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike merge door can report fetch failure after merge and land the same head twice",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2905",
      "rank": 167,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard steady-state CPU ~50% keeps API responses at 0.5-1.5s — profile and fix the residual burner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2828",
      "rank": 168,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done --strike always refuses squash-merged strikes (--is-ancestor can't see through a squash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2824",
      "rank": 169,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review pending dies when one project's lens gather fails (non-degrading caller; PAN-2820 class)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2805",
      "rank": 170,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "FlywheelPage shows 'No active run' while /api/flywheel/current returns a live run — open-questions reveal lands nowhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2792",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Orphan-process sweeps killed the dashboard and live conversations via lsof +D over Bun-hardlinked node_modules",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2775",
      "rank": 172,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agents die in sweeps: boot-correlated false reaps (live flywheel reaped, convoy reaped 5x) + unexplained simultaneous 3-host kill at 04:34Z",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2763",
      "rank": 173,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace node_modules is symlinked to the primary repo, breaking test resolution — the pattern CLAUDE.md explicitly forbids",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2761",
      "rank": 174,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "done.test.ts asserts a hardcoded URL without stubbing env, so it fails in any agent shell with OVERDECK_DASHBOARD_URL set and looks like a …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2739",
      "rank": 175,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): first-completion detection throws every patrol cycle — non-null assertion on getAgentRuntimeStateSync kills the pan-done nud…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2738",
      "rank": 176,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): strikes deadlock — 'git rebase origin/main' denied as history rewriting, so they cannot sync, gate, or push",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2734",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): merge queue head-of-line zombie — closed PAN-2325 re-triggered on all 294 boots; removeMerge has zero callers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2733",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): substrate-bug-poller has never run — BOT_LOGIN is a git author string, not a GitHub user (49,907 failed polls)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2717",
      "rank": 179,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversation permission waits missing from Awareness; strengthen alert pulse",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2700",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Test artifact recovery consumes a stale .pan/test/result.json — fresh test dispatch insta-failed with the previous run's verdict",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2699",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build regenerates the committed record-cost-event.js bundle — every workspace build dirties the tree and blocks clean-workspace gat…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2697",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-review codex parents enter discovery mode and the supervisor session no-ops every discovery-ready signal — convoy never launches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2696",
      "rank": 183,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Task views still speak beads vocabulary — completed vBRIEF items shown as 'upcoming', plus phantom 'not synced' label",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2686",
      "rank": 184,
      "size": "XS",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Policy strip \"restart pending\" badge never clears after restart-fresh with a new model (record.model is sticky)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1711",
      "rank": 185,
      "size": "M",
      "importance": "medium",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "Root-cause and fix dashboard event-loop stalls under load",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1504",
      "rank": 186,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): pan hygiene — codify orchestration merge/commit/push state audit as a first-class CLI verb + skill + docs",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 187,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): emit TTS announcements on lifecycle events (start, pause, resume, report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 188,
      "size": "M",
      "importance": "high",
      "score": 34,
      "condition": "ok",
      "dependsOn": [
        "PAN-1124"
      ],
      "why": "PAN-1124 follow-up: complete planning-on-main pivot (dropped ACs from scope drift)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3090",
      "rank": 189,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Simple issue page: narrative feed instead of raw transcript, surface the pending question, honest blocked state",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3012",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Back up harness conversation transcripts before harnesses delete them",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2664",
      "rank": 191,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(sync-main): auto-commit completes unresolved merge with conflict markers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2663",
      "rank": 192,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(restart): health probe can accept old dashboard after replacement EADDRINUSE",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2659",
      "rank": 193,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "fs-lock: crash between mkdir(lock) and owner.json write leaves an unreclaimable record lock (successor to #2623)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2656",
      "rank": 194,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): deacon-swarm unit tests read live ~/.overdeck/config.yaml — 6 tests fail whenever swarm.mode=off",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2649",
      "rank": 195,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(palette): Ctrl+K conversation search indexes Claude transcripts only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2627",
      "rank": 196,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tracker): Linear poller is blind after cycle rollover — active-cycle filter returns 0 issues, wiping the whole project from the issue t…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2580",
      "rank": 197,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan tell cannot deliver to codex (GPT) conversations — runtime stays null, delivery door misclassifies live session as zombie",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2563",
      "rank": 198,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm-flavor desktop (npx @overdeck/desktop) lacks node_modules for the server's externalized deps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2554",
      "rank": 199,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): clicking a project doesn't update the browser URL — project view isn't copyable/shareable/bookmarkable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2550",
      "rank": 200,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): npm test exits 0 despite root-suite failures — 31 failed tests reported green at the command level",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2547",
      "rank": 201,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout parses seconds as milliseconds — '--health-timeout 180' waits 180ms then declares failure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2546",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan tell is codex-conversation-unaware — declares live codex sessions zombie and refuses delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 203,
      "size": "M",
      "importance": "high",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bead inspect: drop Check 3 (compile/lint), restrict to foundation beads, add end-of-batch mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2767",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Expose Codex app-server conversation controls in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2685",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Annotated live preview: Codex-style annotate-the-app feedback delivered to agents",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2495",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed CI-green gate — landed red-main change",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT), red-mains legit merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Recurring [pan-dir/auto-commit] GitError on main — half-staged spec file blocks all pan-dir mirroring (continue mirrors never land)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize: CLI aborts complete-planning at 90s while the server handler legitimately finishes later (false ✖ Failed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unidentified duplicate caller fires complete-planning in pairs every ~2 minutes (perpetual loop while session survives)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 211,
      "size": "XS",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning is not serialized or idempotent per issue (spec tmp-rename 500s, bead delete-recreate thrash)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(agents): pan tell contradicts itself on dead ohmypi sessions — 'session is dead and resume failed: it appears healthy'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan plan done swallows vbrief quality lint details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hot-updatable message delivery: version-stamped supervisors + server-side delivery logic",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1775",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remote (Fly.io) work agents appear as real session rows in the issue tree",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1198",
      "rank": 216,
      "size": "M",
      "importance": "high",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace init container's bun install doesn't populate container-node-modules named volume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2645",
      "rank": 217,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add opt-in Observation-first conversation view",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2609",
      "rank": 218,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cross-device sync of conversations and tasks via user-owned git remote",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2582",
      "rank": 219,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): show slot assignments on the vBRIEF DAG + unify swarm/tiered terminology (Lead/Crew or Trunk/Lanes)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2566",
      "rank": 220,
      "size": "L",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Traycer parity epic: gap analysis of capabilities Overdeck lacks",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2565",
      "rank": 221,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-agent conversations: N agent sessions in one task surface with agent-to-agent messaging",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2514",
      "rank": 222,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Claude Code Traffic Inspector — intercept & inspect model API traffic in the dashboard",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2507",
      "rank": 223,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive pipeline scheduler: yield idle work agents to unblock review/test/merge dispatch",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2202",
      "rank": 224,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion — and finalize reports false success",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 225,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "caveman: follow-up gaps — review agent routing, hook execution tests, Settings UI toggle, Experiments view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 226,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace-spawned dashboards must never claim the canonical dashboard port",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3288",
      "rank": 227,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cli): dev-checkout preflight — detect stale node_modules after git pull and fail with 'run bun install' instead of ERR_MODULE_NOT_FOUND",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3270",
      "rank": 228,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "New workspaces have empty node_modules and bun is off PATH, so the documented bun install remedy fails",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3235",
      "rank": 229,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-3113"
      ],
      "why": "Dashboard decision card: render and answer agent pane-choice menus (follow-up to PAN-3228)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3211",
      "rank": 230,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "No honest disposition for closed-without-landing issues — residue rows neither close-able nor reaped",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3181",
      "rank": 231,
      "size": "L",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Own agent memories in Overdeck: migrate harness project memories to a per-repo overdeck-memory orphan branch, mirroring the overdeck-state …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3179",
      "rank": 232,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "A UAT promote is marked complete at merge time — nothing verifies the change reached production, so members read as shipped while prod serv…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3176",
      "rank": 233,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Block UAT batch promotion when the live stack is degraded, unknown, or still starting — the promote path takes no health evidence",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3175",
      "rank": 234,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Model explicit semantic dependencies in merge-train ordering — file overlap cannot see that one feature requires another",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3174",
      "rank": 235,
      "size": "XS",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every polyrepo UAT stack is unreachable: Traefik labels carry the old myn- project prefix, Traefik is never attached to the overdeck-* devn…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 236,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in, v0.11-era ox)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2443",
      "rank": 237,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(costs): OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools), pinned-snapshot adoption",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2442",
      "rank": 238,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(agents): Agent Client Protocol (ACP) as Overdeck's structured control plane — replace tmux keystrokes, transcript parsers, and prompt-…",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2356",
      "rank": 239,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2353"
      ],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2355",
      "rank": 240,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2352",
        "PAN-2354"
      ],
      "why": "Overdeck Anywhere P2: mobile PWA (Needs-You feed, conversation view, pipeline board, Web Push)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2354",
      "rank": 241,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2353",
      "rank": 242,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge (scoped API + Fly 6PN)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2352",
      "rank": 243,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-3132",
      "rank": 244,
      "size": "L",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt xBRIEF v0.9 agentic dispatch fields end-to-end (deftai/xBRIEF#40 alignment)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3131",
      "rank": 245,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support xBRIEF planRef sharding — planning-side authoring and pipeline-wide consumption",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3120",
      "rank": 246,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): MERGE refuses (polyrepo) or silently dead-ends (single-repo) when the scheduler yielded the work agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3113",
      "rank": 247,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface agent-pane choice prompts as inline decision cards in the conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3107",
      "rank": 248,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(infra): productize the memory-attribution census (OOM spikes are unattributable after the fact)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3099",
      "rank": 249,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan restart --health-timeout 120 treated as 120ms; false-failed health check leaves dashboard DOWN",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3096",
      "rank": 250,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(pipeline): pan done fails on generated devcontainer harness — agents infer deletion of workspace infrastructure",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3094",
      "rank": 251,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done merge fallback force-pushes a fast-forward branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3077",
      "rank": 252,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspect/review-supervisor spawns omit --effort, inheriting the harness xhigh default (fires per xBRIEF item)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3061",
      "rank": 253,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3058",
      "rank": 254,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Standing-crew templates: ship preset crew configurations (Claude ladder + OpenAI Sol/Terra/Luna) selectable from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3054",
      "rank": 255,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Benchmark matrix: launch one template issue under N configurations and compare cost/time/outcome",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3040",
      "rank": 256,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan strike fails on polyrepo projects (monorepo-shaped worktree logic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3036",
      "rank": 257,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "False '! INPUT' chip on completed strike agents — pane-idle heuristic misreads post-strike-ready idle as a pending question",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3034",
      "rank": 258,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck session tree misses strike-only and workspace-less issues (no strike node for PAN-3031)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3017",
      "rank": 259,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Issue-page UAT panel: expose the full stack action menu and show the panel consistently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3016",
      "rank": 260,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "URL-address every view: anywhere you navigate in Overdeck, the URL must get you back there",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3015",
      "rank": 261,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan monitor: pull-based background inbox transport for Claude Code sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3014",
      "rank": 262,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Background AI title/about spawns fail: --bare skips credential reads in Claude Code 2.1.209",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3013",
      "rank": 263,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "linear-mcp-auth-hook entries leak into durable ~/.claude/settings.json pointing at dead /tmp/pan-agent-role-* paths",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3011",
      "rank": 264,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support poolside Laguna S 2.1 (118B MoE, 1M ctx) — local via Ollama/vLLM, hosted via OpenRouter",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2983",
      "rank": 265,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 deferred capabilities: lease-based concurrent write mode + LLM semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2982",
      "rank": 266,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review convoy should run skill selftests when sync-sources/skills/** changes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2981",
      "rank": 267,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ctrl-K palette: stale conversation hits 404 on open — search index never prunes deleted sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2980",
      "rank": 268,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "pre-push file-size guard audits the dirty working tree, so another session's uncommitted edits block unrelated pushes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2978",
      "rank": 269,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-install ACP agent CLIs from the setup UI (opt-in, per-agent install recipes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2977",
      "rank": 270,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "ACP agent setup UI: detect installed ACP CLIs, show auth status, and guide login from Settings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2976",
      "rank": 271,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize the ACP harness: any ACP-capable agent CLI as a spawnable runtime (named adapters + custom-agent config)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2968",
      "rank": 272,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt the interactive decision page as the default way to present operator decisions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 273,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector resumes a warm per-issue session instead of cold-spawning per item",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1915",
      "rank": 274,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "enhancement(security): API key at-rest hardening — startup perm check + OS keychain + deprecate plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 275,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pi agent transcripts hide tool-call detail; agent panes lack the Tools show/hide toggle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 276,
      "size": "M",
      "importance": "low",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1048 deferred findings: security, correctness, and model validation gaps",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 277,
      "size": "M",
      "importance": "high",
      "score": 29,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add regression test for /api/review/:issueId/reset preserving work-agent resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2957",
      "rank": 278,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm run build intermittently produces stale frontend bundles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2950",
      "rank": 279,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor god files back under file-size ceilings after the UX overhaul",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2945",
      "rank": 280,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(workspace): pan done rejects Overdeck-generated runtime in polyrepo wrapper repos (.devcontainer/, dev, .pan/review)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2941",
      "rank": 281,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF v3 — lease-based writes and advisory semantic auditor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2936",
      "rank": 282,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle loop.max_steps_exceeded: detect and nudge agents to continue instead of stranding them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2922",
      "rank": 283,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reduce accidental orchestration complexity after performance stabilization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2896",
      "rank": 284,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Warm resource-discovery and membership caches at boot — first click after any restart pays a 20-60s cold compute",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2886",
      "rank": 285,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Placeholder (pending-work-spawn) agents crash auto-resume with 'Unknown model' → stranded troubled forever",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2883",
      "rank": 286,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out deploy row fails for every strike-landed issue — PR resolver hardcodes feature/ branch, can't find strike/ PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2880",
      "rank": 287,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Linear tracker listIssues is a 3N+1 request storm — one MYN membership gather burns the entire 2500/hr Linear budget",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2874",
      "rank": 288,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike landing pipeline cannot merge strikes: verification gate demands a vBRIEF checklist strikes never have, and failed-feedback delivery…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2868",
      "rank": 289,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Desktop window opens at fixed 1400×900 — persist window state and default first run to maximized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2850",
      "rank": 290,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "npm test fails in clean checkout after pretest removes dashboard bundle",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2836",
      "rank": 291,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "okf: in-repo placement presets (okf/, docs/okf/) and /okf migrate to switch placements later",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2813",
      "rank": 292,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scheduler yield never self-clears: yielded work agents stay paused after the blocking review completes/merges",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2810",
      "rank": 293,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace 'vitest --changed' gate diverges from CI: App.test.tsx fails locally on missing selectPendingInputSubjects mock",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2809",
      "rank": 294,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Live-terminal Playwright UAT blocked in containerized workspaces (node-pty musl/glibc mismatch + Vite/Traefik WS Origin 403)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2806",
      "rank": 295,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): strike merge trigger registry splits across dashboard chunks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2796",
      "rank": 296,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(cloister): idle nudge must not advance after failed mandatory inspection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2755",
      "rank": 297,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(review): per-issue review-model override never reached convoy sub-reviewers on the discovery-fork path",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2754",
      "rank": 298,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(swarm): `always` is inert — it behaves exactly like `auto`, contradicting the documented spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2718",
      "rank": 299,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan restart needs a first-class no-dialog reconciliation flag — autonomous restarts must not park a dialog on the operator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2680",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: Docker teardown silently skips a running stack in multi-repo projects (MYN), aborting close-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2679",
      "rank": 301,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "conv-lookup skill: resolve transcripts for codex and pi harness conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2678",
      "rank": 302,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ops: clean blocked state worktrees, fix auricle git-status failure, restore the Deacon (2026-07-14 review outage)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2668",
      "rank": 303,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification/review feedback silently queued to stopped-by-user agents — re-drive not applied on delivery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2667",
      "rank": 304,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reimplement the task-progress admission signal in resource discovery (PAN-2648 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 305,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ci): store-access guard — fail the build on direct store reads outside a domain resolver (PAN-1936 slice)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2006",
      "rank": 306,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline semantics lock-down: Definition of Ready, pickup gates (parked/vetoed/blocks-main), unblock override, and Run definition",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-2005",
      "rank": 307,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: Pickup Forecast — visualize Flywheel pickup order (waves, lanes, planning bottleneck)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1868",
      "rank": 308,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost-bleed circuit breaker: progress-aware, always-on guard against runaway agent spend",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1828",
      "rank": 309,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation fork/handoff harness defaults ignore source conversation harness — silent claude-code coercion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 310,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Scratch/UAT-lifecycle issues (PAN-18031) enter the real pipeline: kanban, review convoys, agent registry — need an ephemeral flag + auto-cl…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 311,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codebase map bootstrapped in planning worktree is never promoted to main (PAN-1788 WI-6 wiring gap)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 312,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Supervisor echo-confirm false negative on long messages → triple-paste delivery (rewrite ×2 + tmux fallback); resumed-conv message still ea…",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1758",
      "rank": 313,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Watch: ready-for-merge work must converge despite a continuously moving main",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1578",
      "rank": 314,
      "size": "M",
      "importance": "high",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub Copilot CLI as a first-class harness (pipeline peer to Claude Code, Pi, Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 315,
      "size": "M",
      "importance": "high",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Project-scoped dashboard nav (deck of tabs per project + conversations/tree column + activity feed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 316,
      "size": "M",
      "importance": "high",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review/specialist agents should run in the workspace Docker container, not inherit host-override",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 317,
      "size": "M",
      "importance": "high",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Type cleanup: strip 'ship' from the Role union and its ~10 downstream references",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2662",
      "rank": 318,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add project context-menu actions scoped to issues currently in the pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2652",
      "rank": 319,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view diverges from Terminal: Claude Code backgrounding forks the session file in-process, invisible to all session-id resoluti…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2651",
      "rank": 320,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(pipeline): simplify lifecycle reconciliation and add a safe post-planning reset",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2646",
      "rank": 321,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): configurable global/project/issue policy UI with default OFF",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2635",
      "rank": 322,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore(server): pay down the 152-error src/dashboard/server typecheck debt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2630",
      "rank": 323,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan binary not on PATH for operator shells or spawned work agents; pan doctor can't be run to diagnose it",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2629",
      "rank": 324,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start kickoff delivery never lands: \"Claude Code did not become ready within 30s\" (both attempts), agent sits idle at empty prompt",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2628",
      "rank": 325,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close aborts at close-issue:transition: \"No tracker available and cannot determine issue type\" for GitHub-tracker project",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2626",
      "rank": 326,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(conversations): allow composer model switching within the same model family (e.g. Sonnet → Fable)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2625",
      "rank": 327,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(onboarding): auto-run /pan-new-project on project creation + setup banner, checklist, teaching empty states, and a guided demo issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2622",
      "rank": 328,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "cloister.toml materializes ALL defaults into the user file — default changes in code never reach existing installs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2608",
      "rank": 329,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Persistent collaboration roles (owner/editor/viewer) and organizations — gated behind the shared-instance milestone",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2600",
      "rank": 330,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire the Codex TUI path after app-server burn-in (no-loss audit gate) — follow-up to PAN-2597",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2572",
      "rank": 331,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Noisy EBADENGINE + deprecation warnings on npx/npm install make a healthy install look broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2560",
      "rank": 332,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "resolveStateReadHomeSync (state-read-home.ts) resolves state dir by path basename, not registry key — migrated projects silently fall back …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2557",
      "rank": 333,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level 'Restart All' context action — restart every agent in a project, throttled by the PAN-2500 memory governor",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2553",
      "rank": 334,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): project-level CI visibility — surface repo/main-branch workflow runs on the Command Deck with click-through to logs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2549",
      "rank": 335,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fly remote workspaces: sync overdeck-state before re-enabling migrated projects",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2548",
      "rank": 336,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [
        "PAN-2558"
      ],
      "why": "chore(state): close the PAN-2541 legacy-fallback deprecation window — delete dual-path resolution once every project carries the D12 marker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 337,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502: Traefik picks unreachable panopticon IP for multi-homed fe/api",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 338,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness selector should restrict OpenAI models to Claude Code only",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 339,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refactor deacon.ts below file-size baseline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 340,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS: /var vs /private/var symlink not canonicalized",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 341,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular reports new frontend cycles + stale baseline in chat/conversations components",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 342,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [
        "PAN-1983"
      ],
      "why": "Migrate or delete the 18 dead panopticon.db modules referenced by ~30 test files (#1983 follow-up)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1983",
      "rank": 343,
      "size": "XS",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove all panopticon.db-supporting code (legacy SQLite layer + db↔db migration + seed-from-legacy)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1918",
      "rank": 344,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): full frontend vitest suite runs in no CI path — npm test limited to 3 files; IssueMissionControl.test.tsx open-handle hang stalls …",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1674",
      "rank": 345,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR .venv (~7.5G) is duplicated into every workspace — 236G across 33 worktrees, caused disk-full ENOSPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 346,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Regression: pi + gpt-5.5 fails with 'No API key for provider: openai-codex' (worked previously)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 347,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run agents on local GPU models via a managed Ollama sidecar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1624",
      "rank": 348,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan handoff --author external: authored doc is socket_write-ten but never submitted — successor sits at empty welcome screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 349,
      "size": "M",
      "importance": "high",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unblock Pi source forks — remove API guard, verify transcript parsers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1424",
      "rank": 350,
      "size": "M",
      "importance": "high",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Model pool dispatch + work.* subtype taxonomy (follow-up to PAN-1122)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1357",
      "rank": 351,
      "size": "M",
      "importance": "high",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Template conversations: load curated skill bundles into a single conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 352,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-relaunch npx @overdeck/core under a compatible Node 22+ instead of failing on old Node",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 353,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): deleteResourceVenvEffect's HttpRouter.schemaParams call fails typecheck under the root tsconfig (masked by src/dashboard/**…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 354,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(parity): align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 355,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(needs-you): pane-detected waits (rate-limit/session-resume) surface as 'needs you' but cannot be answered from the dashboard — only the…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 356,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers to eliminate silent npx install failures from sharp 0.32 postinstall",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 357,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(tree): strike agents are invisible in the project issue tree — needs-you pings with no node to click",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2487",
      "rank": 358,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(ship): CI-green merge skip + Ship & Merge cockpit view (live door log + progress) + active-node spinner",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 359,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep added; verb-coverage prompt rule ad…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 360,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(swarm): issue-level assembly owner — 'all slots done' must deterministically trigger assemble → verify → review (root cause of PAN-238…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 361,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(records): close-out/record writer clobbers closeOut.usage with EMPTY data — cost history lost on the local side (recurring)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 362,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(done): pan done's PR lookup fails at MYN polyrepo root — 'no git remotes found' makes completion exit nonzero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 363,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished branches",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 364,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "start-planning: GITHUB_REPOS env shadows projects.yaml github_repo; unknown IDs fall through to Linear and plan the wrong issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 365,
      "size": "XS",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): MYN workspace Traefik routing broken post-rebrand — legacy 'panopticon' network + missing traefik.docker.network label make…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 366,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(workspace): pan workspace rebuild hardcodes 'overdeck-' compose project prefix — mismatches project templates and verification containe…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 367,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(infra): rebuilding dist under a live server breaks lazy chunk imports — 'Cannot find module dist/dashboard/<chunk>.js'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 368,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 369,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): context-overflow recovery is inconsistent — some agents get the PAN-1781 compact-respawn, others hit the PAN-1980 rotation r…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 370,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): enforce the workspace boundary — work agents must not edit the primary checkout (PAN-2204 class, reproduced 3x on 2026-07-0…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 371,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cli): pan start --auto commits the spec to main AFTER creating the worktree — agent's own workspace lacks its spec, causing wrong-works…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 372,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree remo…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 373,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(tiered): wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 374,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(config): one invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 375,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts (\"no saved history\")",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 376,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 377,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server.service (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid on th…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 378,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): three event types missing from DomainEvent schema union poison the RPC stream — permanent \"Reconnecting…\" loop",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 379,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: migrate STATE-STORAGE-AUDIT.md content to living docs, then delete",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 380,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT-STATE-PLANES.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 381,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh AGENT_TYPES_INDEX.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 382,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh pan-done.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 383,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh KANBAN-MODEL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 384,
      "size": "S",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: refresh MISSION-CONTROL.md — update, harden, make useful",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "chore: review the full open backlog for junk/stale/nonsensical issues — produce a categorized document for operator review (FIND ONLY, do N…",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-2308",
      "rank": 386,
      "size": "L",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "hardening(workspaces): migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic container boot refusals (f…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "feat(overdeck): built-in web browser surface (openable like terminal/Claude Code/Codex) + native Agentation integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2288",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "tmux managed-server: lossless auto-migration of dirty-founded servers + boot-time ensure call (PAN-1798 follow-up)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(supervisor): every supervisor.log line written twice — log() appendFile + launcher stdout redirect target the same file",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view shows no history for ohmypi-harness conversations — pi transcript surface missing (conv 353)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 391,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumed conversations wedge without writing transcripts when dashboard is black-holed — views diverge from terminals (conv 367 et al.)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add zcode harness and make it the default for glm-5.2",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 393,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: route kimi-k2 through ohmypi harness instead of CLIProxy (eliminates 200k-window illusion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Capability-tiered work-agent model selection: difficulty→capability-floor routing from benchmark-anchored eval data",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1577",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Move a conversation to a different project (CLI + drag/drop + menu action)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1571",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Large multi-line pastes (handoff docs) land unsubmitted — paste/submit verification is blind to Claude's collapsed \"[Pasted text +N lines]\"…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Defensive mitigation: auto-recover conversations poisoned by Claude Code thinking-block resume 400 (upstream #63147)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Session/activity feed: coalesce review-spawn spam, supersede re-reviews per issue, keep active conversations most-recent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1313",
      "rank": 399,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 400,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Swarm: fast-track tier — skip slot dispatch for trivial mechanical items",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1254",
      "rank": 401,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Tailscale integration: advertise dashboard + workspace endpoints over tailnet (Effect-native)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 402,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel: respect issue dependencies before autopicking work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 403,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Perf: projection-cached VCS driver for diff/checkpoint reads (port of t3code #2586)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1196",
      "rank": 404,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Workhorse routing by bead difficulty + subject-matter (single-agent and swarm)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1142",
      "rank": 405,
      "size": "M",
      "importance": "high",
      "score": 26,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add reasoning effort level to per-role / per-conversation model config",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2213",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot allocator picks an orphaned slot index and refuses instead of skipping to the next free one",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot dispatch has no reserved budget — a busy pipeline starves it to zero",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: swarm slot pan done records completion but slot never becomes merge-ready",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2203 follow-up: a swarm slot's completion can trigger the issue-level review pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 410,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label step fails atomically when a hardcoded label (e.g. 'in-planning') is absent from the repo — closed issues keep stale labels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(codex): work agents skip `pan done` (manual push instead) — sandbox blocks its GitHub calls; idle agents spuriously 'troubled'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "stale",
      "dependsOn": [],
      "why": "chore(dashboard): delete dead IssueCockpitBody cockpit subtree (8 files, superseded by IssueMissionControl)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-isolate conversations in a lightweight git worktree (Conductor-style workspaces)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-create lightweight conversation worktrees on project chats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 416,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a failed first send leaves the text in BOTH the composer box and the retry outbox",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: a single send failure clears ALL in-flight optimistic bubbles (and strips siblings' compaction net)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 418,
      "size": "S",
      "importance": "high",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project description: show on click, edit in dashboard, mirror into the project layer (and document what's in .pan and ~/.panopticon)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation transcript: in-page search (Ctrl+F) only finds text in currently-rendered virtualized rows",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1052 follow-up: memory extraction failing 59% on dogfood project + storage layout deviates from spec",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 421,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1231 follow-up: remove or implement Table + Timeline modes in FleetAgentsView (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1389 follow-up: remove or implement Files + Comments tabs in SessionFeedSidebar (scope-creep stubs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 25,
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
      "rank": 424,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-1158: bd export --refuse-empty guard + dolt-empty root cause",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 425,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel start launcher process orphans when orchestrator dies externally",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 426,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1419 follow-up: stale stopped-agent zombies still pollute dashboard list",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1435",
      "rank": 427,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "API keys in ~/.panopticon/config.yaml stored as plaintext",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation agents can leave host main repo in abandoned git rebase state for hours",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan close: archive-planning:move-prd fails when completed/ PRD exists but workspace PRD also exists",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel orchestrator never emits status snapshots — dashboard 'flywheel' pane stays blank during an active run",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "CLI cannot address planning-*/specialist-* sessions — pan tell/pan kill hard-code 'agent-' prefix; no 'pan plan abort'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 432,
      "size": "M",
      "importance": "high",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Promote across-cycle review state to first-class data (cycle SHA, prior findings) instead of prompt-derived",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 433,
      "size": "M",
      "importance": "high",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "Requirements reviewer: classify each AC as in_pr_scope vs whole_feature_scope, only !-block in-PR-scope items",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-3133",
      "rank": 434,
      "size": "S",
      "importance": "low",
      "score": 24,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: TRON encoding for prompt-bound xBRIEF payloads",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unified usage & headroom panel across all provider plans (z.ai, Anthropic, Codex, OpenRouter)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation view does not surface terminal command responses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 437,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resumable Planning node: double-click a planned issue's Planning to resume the planning agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2002",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "[HUMAN-ONLY] Sign & notarize the macOS desktop build (Apple Developer ID)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Backlog Sequencer: one sequencer per project (currently a single global runner scoped to PAN)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "infra: set up smee webhook relay so merge-on-green + post-merge are reactive (not deacon-only)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Create a new issue directly from a kanban column",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1240",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ship-complete PRs going CONFLICTING after main moves need auto re-rebase recovery",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 443,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "stale",
      "dependsOn": [],
      "why": "Substrate: bead can be closed without delivering the work — add per-bead delivery check in pan done",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 444,
      "size": "L",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-1148 unified-dashboard redesign — 32 gaps vs PRD and mockups (full audit)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1173",
      "rank": 445,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan show <bare-number> derives wrong agent ID for PAN-prefixed issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1164",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation diff summaries update live over WebSocket (drop 5s polling)",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1150",
      "rank": 447,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: \"Anthropic is not configured\" warning persists in Model Routing after claude /login (Provider tab disagrees)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 24,
      "condition": "ok",
      "dependsOn": [],
      "why": "v0.9.3 upgraders: stale workhorses.mid: claude-sonnet-4-7 in config.yaml keeps breaking Model Routing saves",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verdict signaling: one host-owned write door; agents journal, host owns the DB cache",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "restartAgent (change harness/model): wipe stale agent-dir session pointers + refresh conversations row",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stop session rotation on resume (behind a constant); one pipeline-membership view from all lenses",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 452,
      "size": "XS",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Finish local-domain rename: pan.localhost → overdeck.localhost",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel must re-validate (re-plan) pre-cutover plans before implementing them",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project pipeline view: true-state buckets + lens reconciliation (pipeline as exception queue)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Source-tagged programmatic delivery into pi conversation agents (extension sendUserMessage + input.source)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 456,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface inspection sub-runs in the issue tree + a parent Inspection node aggregating all item verdicts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: data export — portable bundle (conversations + favorites core; decoupled optional cost ledger) + user-facing Export my data",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 458,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Single source-of-truth reads — one canonical resolver per domain (consolidate the 280+ scattered read endpoints)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(strike): --big flag to lift strike's precision-only scope guard (operator-authorized larger strikes)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(search): configurable web search providers (Exa, Tavily, Brave, Perplexity)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up: move /api/health/agents off agent-directory scans",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 462,
      "size": "XS",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "fast-follow(PAN-1908): collapse issue status to ONE canonical field — labels become a derived projection, not the source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Generalize ToS gate: block ALL non-Claude-Code harnesses from Anthropic-subscription models; gray out + non-selectable + validate everywher…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce harness restrictions with subscription: gray out non-claude-code, validate everywhere",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn work agents from issue workspace slide-out",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fork-into-worktree from conversation branch chip",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1129",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review-request route pushes wrong branch name: 'feature/977' instead of 'feature/pan-977'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels: spurious 'no MCP server configured with that name' banner at conversation startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1113",
      "rank": 469,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversations sidebar lets you message review-specialist sessions, which derails them silently",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 23,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan reload freshness guard must also verify the frontend bundle",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1878",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "process: bake 'docs updated' into acceptance criteria / definition-of-done in role + planning prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 472,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Define handoff strategy for large conversations: external vs source authoring + tail-biased read",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Surface a transcript-size warning on growing conversations (2 MB warn / 10 MB strong-nudge tiers)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): unbounded log growth — deacon.log 687MB / dashboard.log 91MB, no rotation; per-agent skip line logged every 60s patrol",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-linkable Command Deck: reflect selected issue/agent in the browser URL + make activity notifications link to the specific view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 476,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add 'pan switch <id>' — change a running agent's model/harness in one command (kill + fresh-start + re-onboard)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 477,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings → Providers: show each provider's default harness in the collapsed row (no expand needed)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handoff forks stall at \"Injecting…\" then die on double 300s summary timeout — decouple precompaction from the handoff author model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(uat): workspace server container crashloops when dist/dashboard/server.js is missing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm v2 Phase 2: remote slot agents on Fly (B5 follow-up to PAN-1762)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): conversations endpoints fetched via relative /api path — 403 inside workspace/UAT containers (session cookie is on the api-…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(cloister): uat stuck-assembly cap (30m) kills slow-but-alive assemblies and leaves orphaned conflict agents racing the next generation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 483,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): surface + edit the host claude CLI default model (~/.claude/settings.json) from the Settings page",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(settings): harness picker on every Settings → Roles row (plan/work/review/test/ship/strike), not just Flywheel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): UAT assembly/conflict agent — observability surfaces + configurable harness/model (default gpt-5.5 via Codex)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 486,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(cloister): reuse uat-assembly conflict resolutions across generations (rerere or resolution replay)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 487,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon mislabels SIGTERM workspace container restarts as crashes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): adopt externally-completed readyForMerge issues into the pipeline/merge queue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(work): PAN-1700 agent committed .pan/specs/*.vbrief.json mutations — PAN-1124 immutability violated on feature branch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 490,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(test): cloister auto-resume tests fail under full parallel run, pass in isolation — test pollution reddening main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(ci): 'Clean install + server smoke test' hangs (3 consecutive 20-min timeout kills) on feature/pan-1491 and feature/pan-1641 — server b…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(flywheel): conflict-aware merge train + on-demand UAT candidate — stop the rebase-cascade that strands ready PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 493,
      "size": "XS",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show model capability icons in conversation dialogs + complete per-model vision (supportsImages) audit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1223",
      "rank": 494,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-update for users in the field (npm + desktop binaries)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1166",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-introduce /ws/terminal auth gate with a working bootstrap path",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1027",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge-status drift: deacon auto-detect paths set mergeStatus=merged without postMergeLifecycle, never reset on revert",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(fly.io): harden remote workspaces + `pan workspace move` local↔remote (scale-out / overflow slots)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "GPT-5.5/CLIProxy context-window deadlock: conversations get no overflow recovery + 200k window illusion",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): restart-with-model doesn't emit a live event — issue tree shows stale model until manual refresh",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "bug(dashboard): right-click 'restart with <model>' carries model only, never harness — can't move a review off Kimi",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): unify Agents + Resources into one issue-centric holistic view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1657",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: one-off double-check reviews with a user-specified agent/harness + settings-managed default reviewer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills page: make it a full management surface (browse, review, edit, scope, sync status)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skills: scope by audience AND by agent role (conversation/work/review/ship/plan/test), sync accordingly",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(build): run lint:skills from source via tsx, skip CLI dist build (salvaged from PAN-1615 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1653",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "perf(docs-rag): batch local embedding in buildDocsIndex (salvaged from PAN-1617 workspace)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 507,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rabbit-hole drift detection and lift-to-new-conversation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 508,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend local Ollama support to Codex + Claude Code harnesses and dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-platform interactive permission allow/deny onto a PreToolUse hook (provider-agnostic)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate: Claude Code's native .claude/** settings-edit protection wedges in-scope work agents (un-overridable by PreToolUse auto-approve …",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex: surface interactive approval prompts as conversation Q&A (like AskUserQuestion)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: project management actions in unified sidebar",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-933",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review poster cannot post to GitLab MRs (only supports GitHub PRs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan done: polyrepo uncommitted changes check + existing MR handling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 515,
      "size": "M",
      "importance": "low",
      "score": 21,
      "condition": "ok",
      "dependsOn": [],
      "why": "Trust devroot for conversations + atomic .claude.json writes",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 516,
      "size": "S",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "research: evaluate ponytail (DietrichGebert/ponytail) for prompt compression and consider building in-house",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1830",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Reviewer stuck on gpt-5.5 rate-limit modal blocks REVIEWER_READY — synthesis waits forever despite report written (PAN-1696)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Composer: make ephemeral composer state reload-durable (pasted images + unsent/failed message text)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Duplicate skills in picker: code-review collides with official plugin; beads/pan-flywheel/pan-handoff doubled across project+user sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 520,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings permission-mode can desync from resolved config — agents silently use --dangerously-skip-permissions despite 'Auto'",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation-message 500 cause is unloggable: serve mode never writes dashboard.log",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: FilesPane + BrowserPane — file browser and embedded web view implementation details",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): New Terminal button — spawn ad-hoc bash sessions from sidebar / conversation / drawer / palette",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spawn-refusal modal: render the three-button workflow on dirty-workspace 409",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate: state.json with model='gpt-5.5' (a model that doesn't exist)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan review request shows 'fetch failed' instead of actual sync-target-branch error",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 527,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "One-shot sweep of stale feature branches and worktrees predating the reaper",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-630",
      "rank": 528,
      "size": "M",
      "importance": "high",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-tenant workspace isolation with ACLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 529,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Desktop App",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 530,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Hooks system",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 531,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for the Flywheel orchestrator",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 532,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for Caveman (agent output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 533,
      "size": "S",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add user-facing page for RTK (Bash output compression)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash command aliases: /handoff → /pan-handoff (and similar short forms)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat(dashboard): show each conversation's current git branch (port t3code BranchToolbar pattern)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "task(flywheel): tune v1.0 readiness criteria after 30 days of telemetry",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1485",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Auto-archive stale conversations: pre-archive warning at 7 days, archive at 10 days, configurable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 538,
      "size": "XS",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Distinguish general-use skills from Panopticon-only dev skills in pan sync",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Token spend report should aggregate data from repo, not just local machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1481",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add cost-event telemetry for Caveman token savings",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: 93% bypass rate — daemon/hook integration broken",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 542,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "RTK: Add telemetry to measure token savings from bash output compression",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard conversation composer: refactor context indicator to mirror t3code (show cumulative + live separately)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 544,
      "size": "L",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-487: migrate 10 stale .vbrief.json files from docs/prds/active/ to completed/",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Follow-up to PAN-829: voice-sampler.html cleanup in pan-tts repo",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan flywheel report semantics: split read-only snapshot from run finalization",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Merge agent leaves packages/contracts/dist stale — typecheck breaks on every fresh checkout",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Extend the memory Observation pipeline to ad-hoc conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 19,
      "condition": "ok",
      "dependsOn": [],
      "why": "Artifact storage model is unsafe for polyrepo projects — define a canonical \"orchestration repo\"",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: GitHub Copilot subscription provider routing via omp",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 551,
      "size": "L",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: end-to-end test that tool-call steps render in Conversation panel",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: benchmark FIFO vs paste-buffer message delivery latency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: local Ollama model as zero-cost preliminary review role",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: add Bun 1.3.11 regression test to checkOhmypi doctor gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: version-pin extension in package.json and pan doctor mismatch warning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: capture kimi thinking_tokens in ohmypi-parser for complete cost accounting",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: per-provider cost grouping in cost dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 558,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: surface 35+ provider matrix in dashboard model picker",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: extend provider credential passthrough for Groq, Cerebras, Fireworks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "ohmypi: frontend Tools-toggle for conversation view",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel gate gets stuck after orchestrator dies (reboot, crash, partial report)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin cloister start: CLI crashes with SIGSEGV (exit code 139) after handing off to server",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project-templated DB lifecycle: auxiliary databases + seed refresh from prod",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Polyrepo: support non-feature 'main' workspaces alongside feature-*",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lightweight review path for small/trivial PRs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 566,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan up does not kill existing port holders — startup races against orphan dashboard servers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Vite TRAEFIK_ENABLED conflates 'Traefik on' with 'inside container' — breaks pan dev proxy",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 568,
      "size": "XS",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove PANOPTICON_DEV env-var persistence — derive Traefik mode from the running command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Anthropic Enterprise auth: distinguish from consumer subscription for Pi+Anthropic harness gating",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 570,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hook system cleanup: dead inspect-on-bead-close, pan-review-agent inconsistency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Document the hook system in docs/HOOKS.md",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 18,
      "condition": "ok",
      "dependsOn": [],
      "why": "Feedback routing: wrong issueId written to workspace when verification runs for co-active issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent wipe-and-respawn family (work + review): harness/model switch + Complete work reset, with confirmation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "TLDR: deacon supervision + pan doctor check + GC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Decouple specs and PRDs from workspaces — write directly to main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Channels delivery: surface failures, add fallback toggle, route conversations through channels",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Context bloat: agents receive oversized prompts that exceed tool limits and force immediate compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: pinned docs (long-form doc chunking + retrieval)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory: cross-project search mode",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Validate issueId at every shell-string interpolation site (defense in depth)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden launcher generation against shell-quote injection (model and arg quoting)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harden tts_daemon.py: bearer auth, CORS, body size cap, concurrency bound",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 583,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-modify permission handling: stop the interrupt loop without weakening the safety guard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Security: Comment mediation layer to prevent prompt injection via tracker comments",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-project and per-issue model overrides for pipeline roles",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1684",
      "rank": 586,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs(marketing): build full marketing kit + plan (SEO, video list, channels) from MARKETING.md seed",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1683",
      "rank": 587,
      "size": "S",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: canonical agent session-prefix registry + reconcile role taxonomy (ROLES.md/AGENT_TYPES_INDEX/CLAUDE.md) — strike keeps falling out o…",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: Subspace-inspired alternate theme with Inter + JetBrains Mono",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "cost_events retention: 14 months of granular rows accumulating with ad-hoc partial deletions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Audit and consolidate REMOTE/LOCAL gates in work-agent prompt template",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1040",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat(infra): event-driven dispatch for inspect-agent (requiresInspection=true beads)",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1037",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Retire 'planning-' tmux prefix — fold into agent-PAN-N keyed by phase",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-962",
      "rank": 593,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Post-PAN-946: vBRIEF lifecycle follow-up plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Update documentation for vBRIEF v0.6 lifecycle model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 595,
      "size": "L",
      "importance": "low",
      "score": 16,
      "condition": "stale",
      "dependsOn": [],
      "why": "Implement vBRIEF issue sync: migrate and reconcile GitHub issues into specification",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 596,
      "size": "M",
      "importance": "low",
      "score": 16,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shared Sessions v0: GitHub-auth'd shared conversation panel with WebRTC transport",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1553",
      "rank": 597,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Claude Code Fast mode support (and fast-tier pricing)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 598,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Headless review sub-reviewer normal exit misclassified as 'crashed', triggers spurious restart",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 599,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: add conversation for project from sidebar",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 600,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "stale",
      "dependsOn": [],
      "why": "Make vBRIEF the durable task graph source of truth",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 601,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add memory file review and management command",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 602,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fizzy visual pipeline — Kanban mirror for specialist pipeline",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 603,
      "size": "L",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite containerize route: dead code, orphan processes, no pending-op tracking",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 604,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-908: Make work-agent spawn limits configurable and overridable",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 605,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detect ~/.claude.json corruption on startup and surface it in the dashboard",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 606,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add 'Run pan sync' button to configuration menu",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 607,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: add Maintenance panel with Claude Code Organizer + Config Editor quick-launch",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-898",
      "rank": 608,
      "size": "M",
      "importance": "low",
      "score": 15,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard polling and WebSocket efficiency: remaining audit findings",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-833",
      "rank": 609,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent spawn logs ENOTDIR for .git/pan-credentials in worktrees (GitHub App credential loader)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 610,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "stale",
      "dependsOn": [],
      "why": "state.json staleness: lastActivity/costSoFar not updated as agent runs; /api/agents drops phase/cost/lastActivity",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 611,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Make summary optional when forking conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-817",
      "rank": 612,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Improve planning dialog layout and content fit",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-810",
      "rank": 613,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inspector: diagnostic UI when pipeline phase is unknown",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-802",
      "rank": 614,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Resume on conversation session forks instead of resuming",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 615,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost display: cache write tokens not shown separately; investigate Claude Code discrepancy",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-334",
      "rank": 616,
      "size": "M",
      "importance": "low",
      "score": 14,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard server has no duplicate-process protection — zombie instances cause 502",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-262",
      "rank": 617,
      "size": "M",
      "importance": "high",
      "score": 14,
      "condition": "stale",
      "dependsOn": [],
      "why": "Refactor post-merge lifecycle into composable, idempotent operations",
      "gate": "auto",
      "planning": "skip"
    },
    {
      "issue": "PAN-1474",
      "rank": 618,
      "size": "S",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add ACKNOWLEDGEMENTS doc — credit borrowed code from open-source projects (MIT/Apache 2.0)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 619,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "End-to-end review and consolidation of all project documentation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 620,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Borrow Deft's explicit scope-lifecycle transitions for Panopticon agent state machine",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 621,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Skill mapping: Deft Directive v0.20.0-rc.3 ↔ Panopticon CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-790",
      "rank": 622,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-789: Eliminate remaining TanStack Query polling — complete push-first migration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 623,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Post planning Q\\&A answers as issue comment",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 624,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write conflict race: review-agent fails when test-agent write scope not yet released",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 625,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Inter-agent communication skill: send messages to conversation-mode agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 626,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Redesign workspace inspector panel: sidebar layout is cramped and wrong",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 627,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify launch UX and release pipeline for 1.0 — npx panctl, lazy prereqs, cross-platform desktop builds",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 628,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Design prompt-style overlays with model hierarchy and scoped toggles",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 629,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify terminal stack behavior across tmux sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 630,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Track verification/review/test phase churn over time",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 631,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preserve trailing zeros in cost displays",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 632,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add quota/usage inspector for routed model providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 633,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings: warn when model overrides target disabled providers",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 634,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Gemini OAuth support, remove O3/O4-mini, disable GPT-5.4-Pro",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 635,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Historical Metrics Data Persistence — Beyond the 30-Day JSONL Window",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 636,
      "size": "L",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-XXX: Complete Metrics Page Redesign — Real Data, Charts, Time Filtering, and TLDR Analytics",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 637,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation list items lack accessible labels in accessibility tree",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-743",
      "rank": 638,
      "size": "XS",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add consistent new conversation icon actions in Command Deck",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 639,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add right-click fork option to conversation list",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 640,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: wire per-subagent model overrides from settings to Claude Code spawn env",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 641,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Settings page: review and configure overridden subagent model files",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 642,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add provider account telemetry for credits, balances, and usage",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 643,
      "size": "M",
      "importance": "low",
      "score": 13,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agent detail pane missing Merge/Approve button",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 644,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Fix orphaned work-agent start handoff after planning",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-713",
      "rank": 645,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "test: add unit tests for doneCommand and approveCommand",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-709",
      "rank": 646,
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
      "issue": "PAN-702",
      "rank": 647,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "OpenAI provider: add plan/subscription support and fix unregistered model resolution",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 648,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Quick-Create conversation via keystroke using Conversations-page default model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-700",
      "rank": 649,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Detachable terminal for conversation view — popout into OS window",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-687",
      "rank": 650,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Support OpenCode as alternative coding agent",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 651,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan work issue --auto: headless planning → agent handoff without interactive dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 652,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon: detect API rate-limit events, surface on dashboard, auto-restart when window resets",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 653,
      "size": "XS",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace frontend containers not auto-started for panopticon-cli self-hosted workspaces",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 654,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu command catalog drifts: hardcoded array in ComposerPromptEditor needs codegen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 655,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Project Setup Wizard — Dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 656,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Render Excalidraw drawings inline in Claude Code conversations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-646",
      "rank": 657,
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
      "issue": "PAN-637",
      "rank": 658,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Direct issue kickoff (skip planning) from dashboard UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 659,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace quotas and resource governance",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 660,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Loop nodes: iterative agent execution with conditional termination",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 661,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-channel workflow triggers: Slack, Discord, Telegram, GitHub webhooks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 662,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "YAML workflow DAGs: custom per-project pipeline definitions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 663,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hide planning agent from workspace detail pane",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 664,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "ok",
      "dependsOn": [],
      "why": "Plan review loop with configurable reviewer model",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 665,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "closeLinearDirect returns stepOk even when state update never happens",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 666,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deacon has no backoff or escalation for repeated specialist startup failures",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-245",
      "rank": 667,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Ctrl+C aborts planning dialog instead of copying text",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 668,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Deep-wipe leaves local branch and worktree metadata behind",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 669,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Dashboard 'Start Agent' returns success before verifying agent actually started",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 670,
      "size": "M",
      "importance": "low",
      "score": 12,
      "condition": "stale",
      "dependsOn": [],
      "why": "Fix CloisterService tests that require real runtime",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 671,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate Tauri v2 desktop shell",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-984",
      "rank": 672,
      "size": "S",
      "importance": "low",
      "score": 11,
      "condition": "stale",
      "dependsOn": [],
      "why": "Evaluate context-mode MCP server as session continuity + search layer",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 673,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate Karpathy LLM guidelines into all Panopticon CLAUDE.md templates",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 674,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review and update commands-skills.md with all available Panopticon skills",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 675,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Global / search should include conversations in addition to workspace features",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 676,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter credits/plan status endpoint and UI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 677,
      "size": "XS",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Show PLAN badge on costs when under a subscription/plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 678,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Kanban: Show workspace and tmux session counts in stats",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 679,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Handle CTRL-Z to undo accidental conversation archival",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 680,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Slash menu positioned incorrectly — cut off / off-screen",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 681,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add kanban board deeplinks for issue URLs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 682,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Command Deck: preserve state across navigation including URL routing for tabs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 683,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Remove claude-code-router — all providers use direct env var injection",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 684,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add confirmation dialog before applying Optimal Defaults",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 685,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "feat: show changed files diff summary after each agent response in activity view",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-531",
      "rank": 686,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN: Windows Electron support (WSL2 required)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 687,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Unify Resume Agent UX — all entry points should show message input",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 688,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pass --effort flag when spawning planning agents via Cloister",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 689,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent resume with Haiku session summary instead of claude --resume",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 690,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Cost reconciler: auto-trigger on agent lifecycle events with debounce",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 691,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Agent test conversations pollute production database — need test isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 692,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add QwenCoder CLI as a supported runtime alongside Claude Code and Codex",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-465",
      "rank": 693,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add OpenRouter as a model provider",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 694,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Add Qwen 3.6+ model support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 695,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deep-wipe multi-step progress dialog",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 696,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Planning setup screen with SSE progress streaming",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-454",
      "rank": 697,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Crash recovery: detect orphaned agents and present recovery UI on dashboard startup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 698,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Conversation input bar — mode/permissions/workspace selectors",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 699,
      "size": "M",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Adopt remaining Effect patterns — Schema, Platform, Streams, Logging, Testing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 700,
      "size": "L",
      "importance": "low",
      "score": 11,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate remaining REST polling endpoints to Effect RPC",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-924",
      "rank": 701,
      "size": "S",
      "importance": "low",
      "score": 10,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Spike: evaluate GitNexus for Panopticon integration",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-407",
      "rank": 702,
      "size": "XS",
      "importance": "low",
      "score": 10,
      "condition": "ok",
      "dependsOn": [],
      "why": "Run Panopticon from a main workspace for development isolation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 703,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Integrate TLDR summaries into review context manifest",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 704,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "ok",
      "dependsOn": [],
      "why": "Complete PAN-1048 R5: retire dispatchParallelReview body and specialists.ts module",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 705,
      "size": "S",
      "importance": "low",
      "score": 9,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate terminal-bench@2.0 custom agent harnesses for Panopticon integration",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 706,
      "size": "M",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate Vercel Sandbox execution backend support",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 707,
      "size": "S",
      "importance": "low",
      "score": 8,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Research and borrow best features from gstack",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 708,
      "size": "M",
      "importance": "low",
      "score": 7,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Investigate thinking effort levels for agents — reduce signature corruption frequency",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 709,
      "size": "S",
      "importance": "low",
      "score": 7,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate Ultimate Bug Scanner (UBS) for verification gate",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 710,
      "size": "S",
      "importance": "low",
      "score": 7,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Evaluate MCP Agent Mail for inter-agent communication and file reservations",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 711,
      "size": "S",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "docs: add glossary of Panopticon domain terms",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 712,
      "size": "S",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation cleanup: restructure docs, update installation (npx panctl), refresh stale PRDs",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-633",
      "rank": 713,
      "size": "S",
      "importance": "low",
      "score": 6,
      "condition": "ok",
      "dependsOn": [],
      "why": "Update Cloister PRD and docs index — stale relative to implementation",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-299",
      "rank": 714,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Granular session state persistence across context compaction",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 715,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-detect package manager and runtime in workspace setup",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 716,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Workspace templates: pre/post tool hooks for auto-format, typecheck, lint",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 717,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Surface module initialization errors as system-level, not per-issue",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 718,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Project Living Memory — per-project semantic memory for agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 719,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Reset should sync workspace feature branch with latest main",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 720,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Session reasoning capture & collaborative PRD refinement",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 721,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Auto-assign Linear project from project config when creating issues",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 722,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Review skill categorization: all skills available everywhere via personal + workspace",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 723,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Kanban board: fit all columns without horizontal scrolling",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 724,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Agents lack awareness of MCP tools — sync MCP config and inject into prompts",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 725,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Disable Sync with Main button when workspace is up to date",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 726,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add data-testid attributes across dashboard UI and create Playwright smoke test suite",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 727,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Audit dashboard actions: ensure all are available via CLI",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 728,
      "size": "L",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Mobile redesign initiative: full UX/UI overhaul + implementation plan",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 729,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Shift-left post-edit diagnostics — type check after every edit",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 730,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Phase gate validation — mid-implementation acceptance checks",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-198",
      "rank": 731,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Structured audit trail for agent actions",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-190",
      "rank": 732,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-190: Specialized reviewer prompts (industry best-practice checklists)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 733,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-180: Cross-terminal file locking for concurrent agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 734,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-178: Crash recovery with granular task checkpointing",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 735,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-177: Iteration limits with escalation for autonomous agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 736,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-176: Hook-enforced delegation guardrails for specialist agents",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 737,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-175: Pre-compact auto-save hook for agent sessions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 738,
      "size": "L",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-155: Redesign health page with Stitch (system overview, timeline, costs)",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 739,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PAN-146: Refine light mode theming across all dashboard pages",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 740,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost prediction/estimation for in-progress work",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 741,
      "size": "XS",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Cost breakdown modal: show costs by stage and model when clicking cost badge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 742,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Track specialist costs with time period filtering",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 743,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "feat: Add pan test:e2e command for full workflow integration test",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 744,
      "size": "XS",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Guidance needed: Running complex multi-container projects with Panopticon worktrees",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 745,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Documentation: Clarify issue tracker options beyond Linear",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 746,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "PRD files should be committed to feature branch, moved to completed/ on merge",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 747,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Planning should fetch ALL issue context: comments, attachments, linked issues, discussions",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 748,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Add Slack and email notifications for agent events",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 749,
      "size": "M",
      "importance": "low",
      "score": 6,
      "condition": "stale",
      "dependsOn": [],
      "why": "Support multiple merge agents per repository",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 750,
      "size": "M",
      "importance": "low",
      "score": 6,
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
      "from": "PAN-2642",
      "to": "PAN-1868",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-1042",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2466",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-797",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-77",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-570",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-106",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2392",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2443",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2028",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2642",
      "to": "PAN-2029",
      "type": "contains",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3259",
      "to": "PAN-1837",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1983",
      "to": "PAN-1984",
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
      "from": "PAN-1124",
      "to": "PAN-1451",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1990",
      "to": "PAN-3286",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2352",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2353",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2354",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.9
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2354",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2353",
      "to": "PAN-2356",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2078",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2077",
      "to": "PAN-2079",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2079",
      "to": "PAN-2080",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.85
    },
    {
      "from": "PAN-2558",
      "to": "PAN-2548",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3113",
      "to": "PAN-3235",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3280",
      "to": "PAN-3282",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-3282",
      "to": "PAN-3283",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2746",
      "to": "PAN-3283",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2742",
      "to": "PAN-3282",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3248",
      "to": "PAN-3244",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2706",
      "to": "PAN-3274",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3236",
      "to": "PAN-3257",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3234",
      "to": "PAN-3261",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3250",
      "to": "PAN-3062",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3078",
      "to": "PAN-2848",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3118",
      "to": "PAN-3043",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3043",
      "to": "PAN-2758",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2769",
      "to": "PAN-3044",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3272",
      "to": "PAN-3202",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3188",
      "to": "PAN-3168",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2828",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2995",
      "to": "PAN-3047",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2700",
      "to": "PAN-3104",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-3237",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2691",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3023",
      "to": "PAN-2569",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2567",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2379",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2550",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2478",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-1824",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2337",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2454",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-3259",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2376",
      "to": "PAN-3243",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2075",
      "to": "PAN-454",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1775",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1844",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2075",
      "to": "PAN-43",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2075",
      "to": "PAN-1436",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-1666",
      "to": "PAN-1556",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2424",
      "to": "PAN-1676",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2005",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2059",
      "to": "PAN-2006",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2908",
      "to": "PAN-3090",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-3108",
      "to": "PAN-1846",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.8
    },
    {
      "from": "PAN-2888",
      "to": "PAN-2769",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2670",
      "to": "PAN-2635",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-3186",
      "to": "PAN-2824",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    }
  ]
}
```
