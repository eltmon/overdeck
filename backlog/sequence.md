# Backlog Sequence

_Last sequenced: 2026-07-09T08:38:02.226Z · model: zai/glm-5.2 · open: 592_


| rank | issue | size | importance | condition | epic | depends-on | why |
|------|-------|------|------------|-----------|------|------------|-----|
| 6 | PAN-806 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 9 | PAN-2395 | M | critical | ok |  |  | One invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation blocked. |
| 11 | PAN-1560 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 11 | PAN-2500 | XL | critical | ok |  |  | Memory-aware resource governor — autonomous resume skips the RAM admission gate the HTTP spawn path enforces; OOM root cause (host reboot... |
| 12 | PAN-2372 | M | critical | ok |  |  | Swarm slot finishes its beads but never runs pan done — deacon can't converge it; permanent stall in the default nudge mode. |
| 12 | PAN-2469 | L | critical | ok |  |  | Swarm has no issue-level assembly owner — finished swarm work sits invisible-to-every-patrol; root cause of PAN-2388/2383/399 stalls. |
| 12 | PAN-2536 | M | critical | ok |  |  | stoppedByUser flag poisons every autonomous recovery path — deacon rebuilds the workspace stack forever (infinite Docker churn). |
| 12 | PAN-2538 | M | critical | ok |  |  | pan inspect mis-resolves bd bead-id vs vBRIEF item-id; a dead inspect session silently skips the gate — un-inspected beads pass. |
| 13 | PAN-2186 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 13 | PAN-2473 | M | critical | ok |  |  | State-only verdict commits invalidate fresh review/test verdicts — convoys force-respawn in a churn loop (state-plane policy violation). |
| 13 | PAN-2417 | M | critical | ok |  |  | Self-feeding verdict loop — recording a review/test pass as a chore(state) commit invalidates the pass it records; readyForMerge never ho... |
| 13 | PAN-2519 | M | critical | ok |  |  | Wedged-but-alive work agents parked as troubled instead of killed+respawned — the recovery-net liveness gap underlying every wedge class. |
| 13 | PAN-2524 | M | critical | ok |  |  | Review verdict signal hangs after emitting — review.approved never reconciles, so a passed review blocks merge indefinitely. |
| 14 | PAN-2179 | M | critical | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 14 | PAN-2461 | L | critical | ok |  |  | Verification-gate needs-you pause + feedback_delivery_needs_you deadlock — the gate pauses the only delivery target, then parks the issue... |
| 14 | PAN-2537 | M | critical | ok |  |  | ~90 issues look 'in pipeline' only because stale labels were never cleared; a reconciliation patrol restores true signal. |
| 15 | PAN-2169 | M | critical | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 15 | PAN-2486 | M | critical | ok |  |  | Codex rate-limit model-switch dialog wedges agents AND its default silently downgrades to gpt-5.4-mini (~3h silent fleet stall). |
| 15 | PAN-2498 | M | critical | ok |  |  | Swarm failed WORK slots (dead agent) are never auto-redispatched OR surfaced — swarms silently stall at partial completion. |
| 15 | PAN-2534 | M | critical | ok |  |  | Re-review request after rework doesn't dispatch while the prior review agent lingers idle — re-review stalls, merges stick. |
| 15 | PAN-2522 | M | critical | ok |  |  | pan start auto-plan finalizes spec+beads but never auto-spawns the work agent — every auto-planned issue stalls a full tick. |
| 16 | PAN-2381 | M | critical | ok |  |  | Three event types missing from the DomainEvent schema union poison the RPC stream — permanent 'Reconnecting…' loop for every tab. |
| 16 | PAN-2285 | M | critical | ok |  |  | Per-agent codex auth.json rots, wedging agents in a silent 401 token_revoked loop; substrate liveness fix. |
| 16 | PAN-2467 | M | critical | ok |  |  | Multi-repo merge train merges only one repo — strands sibling repos branches; silent partial delivery of a multi-repo feature to prod. |
| 16 | PAN-2485 | M | critical | ok |  | PAN-2469 | Dead-session swarm slot (failed, session dead) has NO automatic recovery — coordinator never requeues and pan swarm recover refuses non-m... |
| 16 | PAN-2520 | M | critical | ok |  |  | PAN-2209 dead-end respawn defers forever on stack-unhealthy; Deacon never auto-rebuilds the stack, so the issue never recovers. |
| 16 | PAN-2516 | M | critical | ok |  |  | Spec plan.status flips are left uncommitted in the shared primary worktree — spec-vs-record drift and blocks the flywheel push loop. |
| 17 | PAN-2422 | M | critical | ok |  |  | Rebuilding dist under a live server breaks lazy chunk imports — first click on a not-yet-loaded path crashes with module-not-found. |
| 17 | PAN-2409 | L | critical | ok |  |  | Enforce the workspace boundary — work agents edited the PRIMARY checkout by absolute path (PAN-2204 class, reproduced 3x on 2026-07-06). |
| 17 | PAN-2518 | M | critical | ok |  |  | pan specialists done hangs forever when the completion-comment POST fails — no timeout/exit; issue stalls in-review with a live agent. |
| 18 | PAN-2495 | M | critical | ok |  |  | PAN-2487 ci-green merge skip bypassed the CI-green gate and landed a red-required-check change on main. |
| 18 | PAN-2466 | M | critical | ok |  |  | Close-out/record writer clobbers closeOut.usage with EMPTY data — local cost history lost on the recurring close path. |
| 18 | PAN-2511 | M | critical | ok |  |  | Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate. |
| 18 | PAN-2502 | M | critical | ok |  |  | Boot reconciliation dialog skipped on full reboot — an empty-candidate race terminally commits resume_all, ungating crashed-agent resume. |
| 19 | PAN-1491 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 20 | PAN-2364 | M | high | ok |  |  | Per-slot failure isolation — one failed-merge slot freezes the ENTIRE issue's swarm behind a manual pan swarm recover. |
| 20 | PAN-2479 | S | high | ok |  |  | claude-code work-agent launcher passes a role file path to --agent (which wants a registered name) — every claude-code work agent exits b... |
| 21 | PAN-2379 | M | high | ok |  |  | Verify gate installs deps warn-only + 60s timeout → false verify failures against empty node_modules, blocking swarm convergence. |
| 21 | PAN-2408 | M | high | ok |  |  | pan start --auto commits the spec to main AFTER creating the worktree — the agent workspace lacks its own spec, triggering wrong-workspac... |
| 22 | PAN-1830 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 22 | PAN-2292 | M | critical | ok |  |  | Peer-port guard regression crash-loops every post-guard workspace server, cascading host dashboard restart churn. |
| 22 | PAN-2416 | S | high | ok |  |  | Codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively. |
| 22 | PAN-2414 | M | high | ok |  |  | Context-overflow recovery is inconsistent — some agents get the compact-respawn, others hit rotation refusal and die holding uncommitted ... |
| 23 | PAN-2228 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 23 | PAN-2168 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 23 | PAN-2475 | S | high | ok |  |  | pan admin db restore-verdicts hangs indefinitely on real runs (dry-run fine) — the verdict-restore repair door is unusable interactively. |
| 23 | PAN-2451 | M | high | ok |  |  | Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits). |
| 24 | PAN-2323 | M | high | ok |  |  | Flywheel respawn after crash starts a blank session instead of resuming the live rich one — orphans operator direction. |
| 24 | PAN-1166 | M | high | ok |  |  | Hard prerequisite of the Overdeck Anywhere epic — re-gate /ws/terminal + bind auth before any remote exposure. |
| 24 | PAN-2445 | M | high | ok |  |  | Deacon lifecycle patrol auto-dispatches PLANNING for stale planning-state issues — off-book, and staffed from Fable when no model is reco... |
| 24 | PAN-2449 | M | high | ok |  |  | GITHUB_REPOS env var shadows projects.yaml github_repo — unknown IDs fall through to Linear and plan the WRONG issue. |
| 25 | PAN-2307 | M | high | ok |  |  | Respawned flywheel sits idle with no kickoff; stuck-remediation starved when dashboard lifetime < patrol duration. |
| 25 | PAN-2454 | M | high | ok |  |  | Ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished, fully-cleared branches. |
| 25 | PAN-2423 | M | high | ok |  |  | pan workspace rebuild hardcodes the overdeck- compose prefix — mismatches project templates and verification container names. |
| 26 | PAN-2259 | M | critical | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 26 | PAN-2293 | M | high | ok |  |  | Patrol cycles >180s read as stale heartbeat mid-cycle; watchdog kills the dashboard on first observation. |
| 26 | PAN-2406 | M | high | ok |  |  | Close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re... |
| 26 | PAN-2478 | S | high | ok |  |  | CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT) — red-mains legit merges. |
| 27 | PAN-2337 | M | high | ok |  |  | In-place build under a live dashboard breaks new PTY-supervisor spawns until restart — pin artifact + atomic reload. |
| 27 | PAN-2351 | M | high | ok |  | PAN-1166 | Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — the security prerequisite that blocks ALL remote exposure. |
| 28 | PAN-2165 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 28 | PAN-2322 | M | high | ok |  |  | Workspace/UAT agent can seize primary :3011 via an override env var — harden the host dashboard-port guard. |
| 28 | PAN-2428 | M | high | ok |  |  | MYN workspace Traefik routing broken post-rebrand — legacy panopticon network + missing traefik.docker.network label make UAT unreachable. |
| 28 | PAN-2430 | M | high | ok |  |  | Frontend typecheck fails with dozens of pre-existing unused-local errors — blocks verification for any frontend-scoped issue. |
| 29 | PAN-807 | L | critical | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 29 | PAN-2331 | S | high | ok |  |  | Codex rate-limit 'switch model?' modal stalls autonomous agents with no auto-dismiss — freezes work. |
| 30 | PAN-2333 | M | high | ok |  |  | Codex weekly-quota exhaustion freezes agents at an unanswerable modal — need resource alert + downshift/pause policy. |
| 30 | PAN-2465 | S | high | ok |  | PAN-2461 | pan done PR lookup fails at MYN polyrepo root — "no git remotes found" makes completion exit nonzero. |
| 30 | PAN-2421 | M | high | ok |  |  | Dashboard server route tests flake under full-suite verification load (timeouts/assert mismatches) but pass in isolation. |
| 31 | PAN-1520 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 32 | PAN-1497 | M | critical | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 32 | PAN-2383 | M | high | ok |  |  | Editable per-issue Standing Crew toggle on the issue view — upgrade PAN-2378's read-only chip; first tiered-execution dogfood issue. |
| 33 | PAN-1650 | L | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 34 | PAN-1557 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 35 | PAN-1452 | M | critical | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 35 | PAN-2390 | M | high | ok |  |  | systemd-oomd killed overdeck-tmux-server (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid. |
| 35 | PAN-2503 | M | high | ok |  |  | Runtime agents table accumulates 700+ closed-issue rows forever — terminal detection is broken and nothing prunes; hot patrol paths bloat. |
| 36 | PAN-804 | L | critical | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 38 | PAN-1113 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 40 | PAN-2170 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 40 | PAN-2376 | XL | high | ok | ✓ |  | Epic: CI/CD reliability — flake policy, verify-to-merge convergence, strike/swarm merge hardening, deploy hygiene, review automation. |
| 40 | PAN-2324 | M | high | ok |  |  | Close-out label transition fails atomically on missing 'in-planning' label — closed issues keep stale labels. |
| 40 | PAN-2526 | L | high | ok |  |  | deacon.ts is a 3615-line god file above its baseline; shrink it so the file-size ratchet can move down again (red-main trap). |
| 40 | PAN-2505 | M | high | ok |  |  | lint:circular is red on main — new frontend cycles + stale baseline; the lint quality gate fails independent of any feature work. |
| 42 | PAN-2106 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 43 | PAN-1770 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 44 | PAN-1766 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 45 | PAN-2308 | M | high | ok |  | PAN-2292 | Migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic boot refusals. |
| 45 | PAN-2521 | S | high | ok |  |  | Pipeline agents wedge on the harness 'switch to gpt-5.4-mini?' rate-limit dialog; disable that reminder at launch so the pane never freezes. |
| 47 | PAN-1416 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 47 | PAN-2499 | XL | medium | ok |  | PAN-2487, PAN-2493 | Unify the three issue views into one progressive-density IssueView (rail/cockpit/console) — operator-reviewed mockup, no-loss. |
| 48 | PAN-955 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 48 | PAN-2377 | M | high | ok |  |  | First-class 'special orders' runs — operator-supplied order book executed with lane semantics (proven manually on RUN-56). |
| 50 | PAN-2493 | M | medium | ok |  | PAN-2487 | Align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) — parity pass. |
| 50 | PAN-2507 | L | high | ok |  |  | Preemptive scheduler: yield idle work agents to free capacity for blocked review/test/merge dispatch — a pipeline-throughput multiplier. |
| 51 | PAN-2075 | XL | high | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 52 | PAN-2492 | M | medium | ok |  | PAN-2486 | Pane-detected waits (rate-limit/session-resume) surface as needs-you but cannot be answered from the dashboard — only the terminal. |
| 53 | PAN-2233 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 54 | PAN-2232 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 55 | PAN-2229 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 55 | PAN-2489 | S | medium | ok |  |  | Strike agents are invisible in the project issue tree — needs-you pings with no node to click. |
| 56 | PAN-2190 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 57 | PAN-2149 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 58 | PAN-2491 | S | medium | ok |  |  | Migrate @xenova/transformers to @huggingface/transformers — eliminates silent npx install failures from sharp 0.32 postinstall. |
| 60 | PAN-2006 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 60 | PAN-2350 | XL | medium | ok | ✓ |  | Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone (PRD-backed, phased). |
| 60 | PAN-2535 | S | medium | ok |  |  | POST /api/agents returns an opaque 500 (not the designed 422) when `bd list` exits non-zero — an inert try/catch around a failing Effect. |
| 62 | PAN-933 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 63 | PAN-334 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 65 | PAN-2080 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 65 | PAN-2352 | M | medium | ok |  | PAN-2351 | Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access — the coffee-shop story (operator-only). |
| 68 | PAN-1207 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 69 | PAN-1198 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 70 | PAN-2468 | L | medium | ok |  |  | OKF knowledge skill v1 — Karpathy-loop wiki + okf-embeddings vector extension (/okf). |
| 70 | PAN-2533 | M | medium | ok |  |  | UAT workspace magic-link login 502s — Traefik picks an unreachable multi-homed IP (regression from PAN-2428); blocks UAT verification. |
| 71 | PAN-1767 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 72 | PAN-2189 | L | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 72 | PAN-2443 | L | medium | ok |  | PAN-2388 | OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools). |
| 73 | PAN-1828 | M | high | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 74 | PAN-2442 | XL | medium | ok |  | PAN-2416 | Agent Client Protocol (ACP) as Overdeck structured control plane — replace tmux keystrokes, transcript parsers, prompt-detection with typ... |
| 75 | PAN-2193 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 76 | PAN-2255 | M | high | ok |  | PAN-2228 | Routine backlog item; rank reflects current shipping leverage. |
| 76 | PAN-2399 | S | medium | ok |  |  | Wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b). |
| 77 | PAN-1618 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 78 | PAN-1209 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 78 | PAN-2424 | XL | medium | ok | ✓ |  | Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated). |
| 80 | PAN-2353 | M | medium | ok |  | PAN-2351 | Overdeck Anywhere P1b: Hermes external-agent bridge — scoped API over Fly 6PN (first external-service integration). |
| 80 | PAN-2528 | M | medium | ok |  |  | Harness picker offers ohmypi for Anthropic+subscription combos it rejects at spawn (ToS) — prevent the invalid choice up front. |
| 81 | PAN-2188 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 84 | PAN-1246 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 85 | PAN-1219 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 85 | PAN-2354 | M | medium | ok |  | PAN-2351 | Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later). |
| 86 | PAN-1217 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 87 | PAN-813 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 88 | PAN-2358 | M | medium | ok |  |  | Restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) — affects non-claude harnesses. |
| 89 | PAN-2202 | L | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 90 | PAN-2288 | M | medium | ok |  |  | Lossless auto-migration of dirty-founded tmux servers + boot-time ensure call (PAN-1798 follow-up). |
| 91 | PAN-1444 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 92 | PAN-1440 | M | high | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 93 | PAN-1436 | M | high | needs-refinement |  |  | Prevents inert agents that look healthy but do no work. |
| 94 | PAN-262 | M | high | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 95 | PAN-2240 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 95 | PAN-2355 | M | medium | ok |  | PAN-2351, PAN-2352 | Overdeck Anywhere P2: mobile PWA — Needs-You feed, conversation view, pipeline board, Web Push. |
| 97 | PAN-1912 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 98 | PAN-1556 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 99 | PAN-1433 | M | high | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 100 | PAN-1330 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 100 | PAN-2334 | M | medium | ok |  |  | Write a Definition of Ready + wire it into the pickup gate to catch junk issues before an agent is spawned. |
| 100 | PAN-2527 | M | medium | needs-refinement |  |  | Harness selector should offer only the ToS-correct native harness per model; today invalid choices are selectable then fail at runtime. |
| 101 | PAN-675 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 102 | PAN-629 | M | high | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 105 | PAN-2392 | M | medium | ok |  | PAN-2387, PAN-2388, PAN-2385 | Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included). |
| 106 | PAN-1454 | L | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 107 | PAN-2059 | XL | high | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 108 | PAN-1889 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 110 | PAN-1578 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 111 | PAN-1558 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 112 | PAN-1254 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 113 | PAN-1253 | M | high | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 114 | PAN-630 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 115 | PAN-2394 | M | medium | ok |  |  | Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts — 'no saved history'. |
| 116 | PAN-2079 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 117 | PAN-2078 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 118 | PAN-2077 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 119 | PAN-1451 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 120 | PAN-1218 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 120 | PAN-2514 | XL | medium | needs-refinement |  |  | Dashboard Observability page intercepts model API traffic as collapsible blocks — see exactly what eats each request's context. |
| 121 | PAN-1561 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 122 | PAN-1538 | M | high | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 123 | PAN-1357 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 126 | PAN-1915 | M | high | ok |  |  | Closes security exposure in local/operator configuration. |
| 127 | PAN-2027 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 128 | PAN-1913 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 129 | PAN-1544 | M | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-1525 | L | high | ok |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 130 | PAN-2356 | M | medium | needs-refinement |  | PAN-2351 | Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door (product phase). |
| 131 | PAN-1504 | M | high | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 132 | PAN-1196 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 133 | PAN-1142 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 134 | PAN-1435 | M | high | ok |  |  | Closes security exposure in local/operator configuration. |
| 135 | PAN-578 | M | high | needs-refinement |  |  | Closes security exposure in local/operator configuration. |
| 136 | PAN-1424 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 137 | PAN-1313 | L | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 138 | PAN-1311 | M | high | needs-refinement |  |  | Substrate work; improves the foundation required for reliable shipping. |
| 140 | PAN-2252 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 141 | PAN-1755 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 142 | PAN-1691 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 143 | PAN-1627 | M | medium | ok |  |  | Stops resumed conversations from silently losing transcript writes. |
| 144 | PAN-1572 | M | medium | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 145 | PAN-1437 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 146 | PAN-1245 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 147 | PAN-1208 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 148 | PAN-1154 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 150 | PAN-687 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 150 | PAN-2287 | XS | low | ok |  |  | Every supervisor.log line is written twice (appendFile + stdio redirect) — misled incident triage. |
| 150 | PAN-2487 | M | low | ok |  |  | CI-green merge skip + Ship & Merge cockpit view + active-node spinner — LANDED on main; only SSE/polyrepo/persist follow-ups remain. |
| 151 | PAN-1824 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 152 | PAN-2280 | M | medium | ok |  | PAN-2252 | Stops resumed conversations from silently losing transcript writes. |
| 154 | PAN-1937 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 155 | PAN-1897 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 156 | PAN-1816 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 157 | PAN-1674 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 158 | PAN-1672 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 160 | PAN-1490 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 160 | PAN-2484 | S | low | ok |  |  | fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep LANDED on main. |
| 161 | PAN-1446 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 162 | PAN-1438 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 163 | PAN-1392 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 164 | PAN-1386 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 167 | PAN-1173 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 168 | PAN-1131 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 169 | PAN-1130 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 170 | PAN-1129 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 171 | PAN-1027 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 176 | PAN-886 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 177 | PAN-681 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 178 | PAN-658 | M | medium | ok |  | PAN-2356 | Shared Sessions v0 — Phase 4 of Overdeck Anywhere, sequenced after the #2356 relay (plain WSS rooms, WebRTC deferred). |
| 180 | PAN-324 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 180 | PAN-2319 | S | low | ok |  |  | 'COST LIMIT REACHED for undefined' spams every cycle — fix undefined subject, throttle, configurable default. |
| 180 | PAN-2444 | M | low | needs-refinement |  |  | Optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in). |
| 181 | PAN-1122 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 182 | PAN-1565 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 183 | PAN-1461 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 184 | PAN-1128 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 186 | PAN-900 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 187 | PAN-764 | M | medium | ok |  |  | GitHub quota failures block close, edit, and orchestration paths. |
| 190 | PAN-1234 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 191 | PAN-1232 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 194 | PAN-1837 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 197 | PAN-1643 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 198 | PAN-1641 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 199 | PAN-1553 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 200 | PAN-1482 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 200 | PAN-2295 | XL | medium | needs-refinement |  |  | Built-in web-browser surface (openable like terminal/Codex) + native Agentation integration — needs design. |
| 201 | PAN-771 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 202 | PAN-752 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 203 | PAN-702 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 204 | PAN-466 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 205 | PAN-463 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 206 | PAN-2085 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 207 | PAN-1986 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 208 | PAN-1958 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 209 | PAN-1761 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 210 | PAN-1655 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 211 | PAN-1356 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 212 | PAN-777 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 213 | PAN-576 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 214 | PAN-468 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 215 | PAN-452 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 216 | PAN-2069 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 217 | PAN-2005 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 218 | PAN-1951 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 219 | PAN-1862 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 220 | PAN-1852 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 221 | PAN-1775 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 223 | PAN-1696 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 224 | PAN-1610 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 225 | PAN-1102 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 226 | PAN-783 | L | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 227 | PAN-1983 | L | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 228 | PAN-2245 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 229 | PAN-2244 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 230 | PAN-2243 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 231 | PAN-2242 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 232 | PAN-2241 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 233 | PAN-2237 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 234 | PAN-1795 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 235 | PAN-1673 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 236 | PAN-1624 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 238 | PAN-1530 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 239 | PAN-1449 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 240 | PAN-1445 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 241 | PAN-1240 | L | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 242 | PAN-1150 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 243 | PAN-1149 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 244 | PAN-1068 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 245 | PAN-1042 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 246 | PAN-932 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 247 | PAN-304 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 248 | PAN-1896 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 249 | PAN-1577 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 250 | PAN-1533 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 250 | PAN-2347 | M | low | ok |  |  | Refresh AGENT-STATE-PLANES.md into the definitive, source-verified state-storage reference. |
| 252 | PAN-2212 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 253 | PAN-2211 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 254 | PAN-2210 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 255 | PAN-2209 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 255 | PAN-2344 | M | low | ok |  |  | Rewrite KANBAN-MODEL.md to match the current pipeline phases, gates, and two-door state model. |
| 257 | PAN-2197 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 259 | PAN-2032 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 260 | PAN-2004 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 260 | PAN-2345 | S | low | ok |  |  | Refresh pan-done.md to document the current done→rebase→push→PR→review chain and verify-on-main pause. |
| 261 | PAN-1995 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 262 | PAN-1990 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 262 | PAN-2343 | S | low | ok |  |  | Rewrite MISSION-CONTROL.md against current dashboard architecture and state-label computation. |
| 263 | PAN-1988 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 264 | PAN-1985 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 265 | PAN-1980 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 265 | PAN-2346 | S | low | ok |  |  | Refresh AGENT_TYPES_INDEX.md to cover the current agent-ID patterns and role/ceiling semantics. |
| 266 | PAN-1967 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 267 | PAN-1966 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 268 | PAN-1965 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 268 | PAN-2348 | S | low | ok |  | PAN-2347 | Migrate still-relevant STATE-STORAGE-AUDIT.md content into living docs, then delete the frozen audit. |
| 270 | PAN-1914 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 271 | PAN-1895 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 272 | PAN-1874 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 273 | PAN-1846 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 274 | PAN-1844 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 275 | PAN-1840 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 276 | PAN-1774 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 277 | PAN-1773 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 278 | PAN-1758 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 279 | PAN-1751 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 280 | PAN-1750 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 281 | PAN-1748 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 282 | PAN-1740 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 284 | PAN-1735 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 286 | PAN-1728 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 288 | PAN-1720 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 289 | PAN-1676 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 290 | PAN-1668 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 291 | PAN-1667 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 292 | PAN-1666 | XL | medium | ok | ✓ |  | Container; ranks by child impact, not directly pickable. |
| 293 | PAN-1657 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 294 | PAN-1656 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 298 | PAN-1581 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 299 | PAN-1542 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 300 | PAN-2504 | M | low | ok |  |  | npx @overdeck/core fails on old Node after a slow install; auto-relaunch under a detected Node 22+ to remove first-run friction. |
| 301 | PAN-1432 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 302 | PAN-1244 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 303 | PAN-1165 | M | medium | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 304 | PAN-1147 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 305 | PAN-1136 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 306 | PAN-1133 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 307 | PAN-1126 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 308 | PAN-1124 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 309 | PAN-1121 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 311 | PAN-1066 | L | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 312 | PAN-1037 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 313 | PAN-943 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 314 | PAN-938 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 315 | PAN-908 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 317 | PAN-833 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 318 | PAN-832 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 319 | PAN-778 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 320 | PAN-775 | L | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 321 | PAN-769 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 322 | PAN-736 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 323 | PAN-735 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 324 | PAN-727 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 325 | PAN-709 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 326 | PAN-678 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 327 | PAN-624 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 328 | PAN-622 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 329 | PAN-613 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 330 | PAN-606 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 331 | PAN-604 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 332 | PAN-603 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 333 | PAN-568 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 334 | PAN-538 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 335 | PAN-483 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 336 | PAN-480 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 337 | PAN-476 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 338 | PAN-471 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 342 | PAN-637 | M | medium | ok |  |  | Prevents inert agents that look healthy but do no work. |
| 343 | PAN-531 | M | medium | ok |  |  | Prevents workspace servers from impersonating production dashboard. |
| 344 | PAN-38 | M | medium | stale |  |  | Prevents workspace servers from impersonating production dashboard. |
| 345 | PAN-37 | M | medium | stale |  |  | Prevents workspace servers from impersonating production dashboard. |
| 346 | PAN-1868 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 347 | PAN-1488 | M | medium | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 349 | PAN-2282 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 350 | PAN-2084 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 350 | PAN-2501 | S | low | ok |  |  | deleteResourceVenvEffect's HttpRouter.schemaParams call fails root-tsconfig typecheck (masked by src/dashboard exclusion) — latent. |
| 351 | PAN-2046 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 352 | PAN-2034 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 353 | PAN-2024 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 354 | PAN-1854 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 355 | PAN-1853 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 356 | PAN-1646 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 358 | PAN-1623 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 360 | PAN-1571 | M | medium | ok |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 361 | PAN-1552 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 362 | PAN-1545 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 363 | PAN-1485 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 364 | PAN-1473 | M | medium | ok |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 365 | PAN-1123 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 366 | PAN-949 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 367 | PAN-818 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 368 | PAN-772 | M | medium | ok |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 369 | PAN-747 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 370 | PAN-738 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 371 | PAN-649 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 372 | PAN-565 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 373 | PAN-1776 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 374 | PAN-1685 | L | medium | needs-refinement |  |  | Prevents workspace servers from impersonating production dashboard. |
| 377 | PAN-1164 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 378 | PAN-1101 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 379 | PAN-947 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 380 | PAN-608 | M | medium | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 381 | PAN-247 | M | medium | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 382 | PAN-113 | M | medium | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 384 | PAN-2070 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 385 | PAN-2068 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 386 | PAN-1769 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 387 | PAN-1711 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 388 | PAN-1683 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 389 | PAN-1469 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 390 | PAN-1227 | M | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 391 | PAN-1226 | L | low | needs-refinement |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 392 | PAN-633 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 394 | PAN-1654 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 395 | PAN-853 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 396 | PAN-810 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 397 | PAN-793 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 398 | PAN-774 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 399 | PAN-663 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 400 | PAN-589 | M | low | ok |  |  | Hardens the pipeline paths that ship all other work. |
| 400 | PAN-2335 | M | low | ok |  |  | Find-only categorized junk-backlog review document; operator-gated, keep on backlog (do NOT action). |
| 400 | PAN-2506 | XS | low | ok |  |  | flywheel-primary-root.test.ts fails on macOS — /var vs /private/var symlink not canonicalized; CI (Linux) is green. |
| 401 | PAN-454 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 402 | PAN-407 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 403 | PAN-2266 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 404 | PAN-2213 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 405 | PAN-2201 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 406 | PAN-2195 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 407 | PAN-2091 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 408 | PAN-2083 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 409 | PAN-2082 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 410 | PAN-2065 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 411 | PAN-2045 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 412 | PAN-2035 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 413 | PAN-2033 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 414 | PAN-2031 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 415 | PAN-2030 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 416 | PAN-2029 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 417 | PAN-2028 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 418 | PAN-2026 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 419 | PAN-2025 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 420 | PAN-1999 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 421 | PAN-1991 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 422 | PAN-1987 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 423 | PAN-1968 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 427 | PAN-1949 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 428 | PAN-1936 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 429 | PAN-1926 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 430 | PAN-1916 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 431 | PAN-1910 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 432 | PAN-1907 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 433 | PAN-1906 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 434 | PAN-1839 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 435 | PAN-1782 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 436 | PAN-1754 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 438 | PAN-1710 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 439 | PAN-1671 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 440 | PAN-1669 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 441 | PAN-1640 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 442 | PAN-1592 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 444 | PAN-1550 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 446 | PAN-1524 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 448 | PAN-1489 | M | low | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 449 | PAN-1481 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 450 | PAN-1480 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 450 | PAN-2532 | S | low | ok |  |  | Pipeline rows truncate the title early while horizontal space sits empty — reclaim width for the title without adding height. |
| 451 | PAN-1479 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 452 | PAN-1474 | S | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 453 | PAN-1442 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 454 | PAN-1325 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 455 | PAN-1242 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 457 | PAN-1222 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 459 | PAN-1153 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 460 | PAN-1116 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 461 | PAN-1065 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 462 | PAN-1064 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 463 | PAN-1063 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 464 | PAN-1060 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 465 | PAN-1049 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 466 | PAN-1041 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 467 | PAN-962 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 468 | PAN-958 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 470 | PAN-944 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 471 | PAN-927 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 473 | PAN-903 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 474 | PAN-902 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 475 | PAN-863 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 477 | PAN-790 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 478 | PAN-786 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 479 | PAN-773 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 480 | PAN-765 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 481 | PAN-762 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 482 | PAN-751 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 483 | PAN-750 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 484 | PAN-749 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 485 | PAN-730 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 487 | PAN-660 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 488 | PAN-623 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 489 | PAN-607 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 491 | PAN-570 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 492 | PAN-564 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 493 | PAN-554 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 495 | PAN-548 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 496 | PAN-546 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 497 | PAN-543 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 498 | PAN-537 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 499 | PAN-532 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 500 | PAN-465 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 501 | PAN-461 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 502 | PAN-459 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 503 | PAN-450 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 504 | PAN-438 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 505 | PAN-399 | M | low | needs-refinement |  |  | Hardens the pipeline paths that ship all other work. |
| 506 | PAN-198 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 509 | PAN-743 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 510 | PAN-701 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 511 | PAN-175 | M | low | stale |  |  | Restores conversation/session visibility across non-Claude harnesses. |
| 512 | PAN-2008 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 513 | PAN-1984 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 514 | PAN-49 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 516 | PAN-826 | M | low | needs-refinement |  |  | Shrinks oversized substrate files so future changes stay tractable. |
| 517 | PAN-802 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 518 | PAN-700 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 519 | PAN-1653 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 521 | PAN-244 | M | low | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 522 | PAN-2073 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 523 | PAN-2072 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 524 | PAN-2071 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 525 | PAN-2067 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 526 | PAN-1878 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 527 | PAN-1443 | L | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 528 | PAN-1135 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 529 | PAN-1117 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 530 | PAN-961 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 531 | PAN-634 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 532 | PAN-2037 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 533 | PAN-2002 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 534 | PAN-1918 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 535 | PAN-1483 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 536 | PAN-1152 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 537 | PAN-1151 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 538 | PAN-1051 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 539 | PAN-1040 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 540 | PAN-984 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 541 | PAN-901 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 543 | PAN-791 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 544 | PAN-654 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 545 | PAN-591 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 546 | PAN-571 | M | low | ok |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 547 | PAN-298 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 548 | PAN-297 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 549 | PAN-293 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 550 | PAN-283 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 551 | PAN-265 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 552 | PAN-255 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 553 | PAN-252 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 554 | PAN-190 | M | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 555 | PAN-180 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 556 | PAN-177 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 557 | PAN-176 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 558 | PAN-47 | L | low | stale |  |  | Hardens the pipeline paths that ship all other work. |
| 559 | PAN-43 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 560 | PAN-2066 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 561 | PAN-1223 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 562 | PAN-898 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 563 | PAN-817 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 564 | PAN-797 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 565 | PAN-713 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 567 | PAN-245 | M | low | stale |  |  | Bug fix with direct operator or pipeline reliability impact. |
| 568 | PAN-1684 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 569 | PAN-674 | M | low | ok |  |  | Documentation improvement; useful but lower shipping leverage. |
| 571 | PAN-2074 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 572 | PAN-924 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 573 | PAN-646 | M | low | needs-refinement |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 574 | PAN-299 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 575 | PAN-294 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 576 | PAN-277 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 577 | PAN-271 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 578 | PAN-258 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 579 | PAN-243 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 580 | PAN-228 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 581 | PAN-227 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 582 | PAN-178 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 583 | PAN-155 | L | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 584 | PAN-146 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 585 | PAN-106 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 586 | PAN-104 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 587 | PAN-77 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 588 | PAN-55 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 589 | PAN-54 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 590 | PAN-44 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 591 | PAN-51 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 592 | PAN-249 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 593 | PAN-241 | L | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |
| 594 | PAN-52 | M | low | stale |  |  | Routine backlog item; rank reflects current shipping leverage. |

## Rationale detail

### PAN-806 (rank 6)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2395 (rank 9)

Live incident (2026-07-05): a YAML boolean-coerced enum threw on every config load, falsely ending a live conversation and blocking resume/creation. Data-corrupting + liveness-killing; critical substrate.

### PAN-1560 (rank 11)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2500 (rank 11)

Root cause of two host OOM/reboot events: the autonomous resume/dispatch path skips the memory admission gate the HTTP spawn path enforces. A data-corrupting + liveness-killing substrate fix for the shipping pipeline itself; epic PAN-1666 child. Now in-pipeline.

### PAN-2372 (rank 12)

Still the PAN-2357-family durable-completion swarm gap (empty continue.json) — rank preserved.

### PAN-2469 (rank 12)

5-whys root cause: swarm slots complete individually but nothing owns the all-slots-done transition to assemble/verify/review. Days lost to this; the deacon logs a spammed symptom every 60s. Critical substrate for swarm convergence.

### PAN-2536 (rank 12)

Live on PAN-2468 (2026-07-09): a review-failed work agent carrying stoppedByUser=true can never be autonomously recovered — every recovery path respects the flag, so the deacon spins on rebuild-and-start, reaps the idle stack after 15m, and rebuilds again, indefinitely. Data-wasting + liveness-killing substrate defect; unblocks the operator's manual recovery and the broader recovery net.

### PAN-2538 (rank 12)

Live on PAN-2468 (2026-07-09): pan inspect --bead <bd-bead-id> fails because the bd-assigned bead id is not the vBRIEF item id, and the fallback inspect session exited before emitting a verdict — the failure was swallowed as 'infrastructure failure', so the bead passed un-inspected. A silent inspection-gate skip lets uninspected work advance; critical substrate-integrity fix.

### PAN-2186 (rank 13)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2473 (rank 13)

Every verdict write lands a state-plane commit, HEAD moves, staleness machinery treats the fresh verdict as stale and re-dispatches. Each spurious cycle burns a full review convoy (~20-40 min + tokens). State-plane predicate missing from the verdict comparison. In-pipeline (merged/verifying).

### PAN-2417 (rank 13)

Sibling of PAN-2473: PAN-2402 earned review+test+readyForMerge three times in 90 min and lost it within seconds each time. The verdict-recording commit is itself the staleness trigger. Critical merge-readiness blocker. In-pipeline (merged/verifying).

### PAN-2519 (rank 13)

The unifying recovery-net gap: the pipeline trusts 'session exists?' (PAN-2209 respawn only fires when the session is gone) and 'hooks say idle?' (stuck-remediation parks the agent as troubled). A wedged-but-alive agent (context-death, hung call, blocking dialog) defeats both and stalls invisibly to respawn. Fixing it (kill+respawn for rework-holding wedged agents, circuit-breaker guarded) closes the whole wedge cluster.

### PAN-2524 (rank 13)

Live RUN-60 on PAN-2360: the review agent printed '✓ Review passed' then the signal CLI hung and had to be interrupted; review.approved never reconciled (not spontaneously, not on the stop-event), stranding a clean, mergeable PR. Every occurrence forces a redundant manual pan review request re-run. Critical merge-velocity defect.

### PAN-2179 (rank 14)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2461 (rank 14)

The gate creates the condition (agent paused) that makes feedback delivery impossible; nothing resumes or re-verifies when the env heals. Six issues parked simultaneously. Plus no local flake tolerance and container-down gates mislabel as lint failures. Critical pipeline-flow blocker.

### PAN-2537 (rank 14)

Of 107 issues carrying a pipeline label, only ~5 have a live agent; 52 carry a frozen verifying-on-main label (merged long ago, never closed-out) and 40 a stale planning label. Close-out is the durable label owner but these merged during incidents and bypassed it, so the dashboard/kanban drown the active handful. A label/read-model reconciliation patrol is the substrate fix for truthful pipeline signal — operator's primary visibility surface.

### PAN-2169 (rank 15)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2486 (rank 15)

strike + 2 work agents wedged 1-3h on an interactive dialog no automation dismisses; dismissing via the delivery door confirmed the DEFAULT (switch to mini), silently downgrading substrate-coding sessions. Liveness + invisible quality risk.

### PAN-2498 (rank 15)

A failed work slot (missing-agent/vanished-session) is only logged then dropped; its item is never reset to pending and its dead branch holds the slot index, so dispatchNextWave can never refill. Permanent silent stall (PAN-399 sat 1/3 for a day). Critical swarm-liveness gap.

### PAN-2534 (rank 15)

Live RUN-60 on PAN-2270: pan review request after rework spawned no new review for ~6 minutes because dispatch keys off the prior review agent stopping, and it never stops on its own after writing its verdict. Re-review stalls until an operator force-kills the lingering agent. Critical in-pipeline velocity / stuck-merge defect.

### PAN-2522 (rank 15)

Live RUN-60 (twice): pan start's auto-plan completed cleanly (spec written, beads materialized, committed on main) but the promised 'work agent will start automatically after planning finalizes' never fired; the issue sat with no work agent for 7+ minutes until a manual second pan start spawned it from the ready spec. Every auto-planned start loses a full orchestration tick. Critical pipeline-velocity defect.

### PAN-2381 (rank 16)

Operator-facing outage: an unknown event type kills the whole subscription stream incl. heartbeats; every client reconnect-storms. Stream-boundary validation guard + union fix; critical liveness.

### PAN-2285 (rank 16)

A stale seed-once copy of ~/.codex/auth.json forks the OAuth refresh chain, so respawned codex agents wedge permanently in a 401 retry loop while looking healthy on every surface — the same liveness-illusion class as PAN-2172. A staleness re-seed at spawn plus a troubled-gate trip on repeated token_revoked restores reliable codex dispatch, which is a prerequisite for shipping any gpt-5.5-routed work.

### PAN-2467 (rank 16)

MIN-857 was treated as merged/done after only the frontend repo merged; the api branch with UAT-critical commits was left unmerged with no MR. Correctness gap that can ship half a feature to production — a multi-repo train must merge every participating repo before done.

### PAN-2485 (rank 16)

A dead-session failed slot is a terminal classification with no consumer; recover only handles FailedMergeBlock. Required: coordinator owns failed slots (requeue + gc dead branch), recover covers non-merge failures, gcMergedSlots reaps promptly. Part of PAN-2469 state machine.

### PAN-2520 (rank 16)

Live on PAN-2468: PAN-2209's dead-end respawn returns 'stack-unhealthy' when the workspace Docker stack is down, and the deacon logs 'respawn deferred — stack-unhealthy' forever — nothing invokes the existing manual-only rebuild-and-start recovery. The issue is stuck in-review with zero automated path forward. Wiring the deacon to rebuild-and-start on this skip (circuit-breaker guarded) closes the dead-end.

### PAN-2516 (rank 16)

Live RUN-60 on the primary main worktree: pan close/pan start/merge-reconcile flip spec plan.status in the working tree but never commit/push it, so origin/main's spec mirror goes permanently stale for terminal issues (PAN-1124 invariant violation) and the uncommitted tree blocks the flywheel's own push. Critical substrate drift + flywheel-blocking defect.

### PAN-2422 (rank 17)

Intervening npm run build deletes old hashed chunks the live server still resolves at call time. Same deploy-reliability family as PAN-2337/PAN-2380. Fix: versioned dist dir + atomic symlink flip, or eager boot-time imports.

### PAN-2409 (rank 17)

Nothing blocks a work agent from writing outside its workspace; three Haiku agents put real implementation into primary, so review evaluated an incomplete branch. The standing write-to-main hazard, now reproduced. Needs a hard write-boundary.

### PAN-2518 (rank 17)

Live on PAN-2510: pan admin specialists done persists the verdict locally first (durable), then makes an advisory comment POST with no hard timeout and no guaranteed exit; when it stalls, the review/test agent that shelled out waits on it forever and the issue stalls in-review with a live-but-wedged agent. Bounding the advisory call (non-fatal, always exits) is the substrate fix. Recovery-net wedge-gap cluster sibling.

### PAN-2495 (rank 18)

A merge path that can skip CI-green let a PR with a red required test check land on main, reddening main (RUN-58: ~45 min P0 recovery). A skip may only apply to non-required checks; the no-loss audit must be a required blocking gate. Critical gate-integrity fix.

### PAN-2466 (rank 18)

Twice in a day the local per-issue records for just-closed issues were rewritten with empty byStage/totals/merges while the remote carried real usage. Silently destroys exactly the data the cost-visibility program (PAN-2387/2388) builds. Writer must read-modify-write closeOut.

### PAN-2511 (rank 18)

Live RUN-60 on PAN-2167: the work agent ran the full npm test as a self-check, hit spawnSync git EPERM (the sandbox blocks git subprocesses), misread it as a regression, and burned 21+ min waiting to re-run a step that can never pass in its sandbox — redundant with the PAN-174 verification gate that runs in the correct environment. A per-issue cycle-time sink on the metric the operator cares about (in-pipeline velocity).

### PAN-2502 (rank 18)

Live 2026-07-08 boot: on a full box reboot the dashboard stamps the boot-reconciliation snapshot before the deacon child reconciles liveness ~1s later, so the candidate list is empty; the PAN-2076 empty→resume_all fast path terminally commits, skipping the operator dialog AND leaving crashed agents to auto-resume ungated — the exact post-reboot safety problem the dialog exists to prevent. Critical boot-reliability/safety substrate fix.

### PAN-1491 (rank 19)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2364 (rank 20)

failedMergeBlock is per-issue not per-slot, so swarm parallelism serializes on the first problem. Hardening follow-up to the landed PAN-2357; high.

### PAN-2479 (rank 20)

spawnAgent builds --agent roles/work.md, but --agent takes a registered agent name; claude exits 1 with "not found" that the supervisor swallows as a 30s ready-timeout. Surfaces when routing lands on claude-code (kimi). Small, high-leverage fix. In-pipeline (merged/verifying).

### PAN-2379 (rank 21)

Verified live (RUN-56): concurrent bun installs time out, gates run against empty node_modules, deacon re-fails every patrol. False-fail-that-blocks-convergence; high.

### PAN-2408 (rank 21)

Each worktree (branched pre-spec) lacks its .pan/specs/*.vbrief.json while later siblings have it; agents conclude the spec is in the wrong workspace and re-anchor on primary (the direct cause of PAN-2409). Ordering fix: commit spec before worktree creation.

### PAN-1830 (rank 22)

High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.

### PAN-2292 (rank 22)

A dashboard-identity guard refuses PORT=3011 but the devcontainer template still sets it, so every new workspace server crash-loops by design. Regression fix; merged and verifying on main.

### PAN-2416 (rank 22)

A review agent sat ~20 min on the onboarding "Press enter to continue" screen with review_status failed and no notes. Per-session first-run dependent. Spawn path must guarantee no interactive onboarding.

### PAN-2414 (rank 22)

Two agents hit ~100% context the same afternoon with opposite outcomes (PAN-1781 respawn vs PAN-1980 refusal + death with 2 modified files). One deliberate policy for overflow recovery; the PAN-1781 fix must apply uniformly.

### PAN-2228 (rank 23)

Two-door delivery hardening now has a PRD + needs-handoff; stays critical substrate tied to zombie-kickoff (PAN-2179).

### PAN-2168 (rank 23)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2475 (rank 23)

Every non-dry-run invocation hung until killed (60/90/240s) while dry-run completes in seconds; write phase blocks on a lock or unsettled top-level await. Same hang signature seen in pan swarm resume / pan review reset — likely one shared CLI-never-exits root.

### PAN-2451 (rank 23)

Branch 108 commits ahead with merge/auto-commit/overflow-checkpoint messages that fail the issue-ref gate; the agent stalls pre-submit and the deacon does not re-engage a pre-submit-frozen work agent.

### PAN-2323 (rank 24)

A crash-respawned orchestrator reads only resume-session.json (written on graceful pause), so it boots blank and silently abandons the operator's in-flight drain-mode session. Resume-from-live-session fix protects orchestration continuity.

### PAN-1166 (rank 24)

Delta: 2026-07-04 comment makes this the blocking prerequisite of epic PAN-2350 (Phase 0 / PAN-2351 scoped tokens depend on it); bootstrap path already merged, remaining work is the lockdown. Elevated from low to high.

### PAN-2445 (rank 24)

With auto_pickup off and an active order book, the patrol still dispatched planning on claude-fable-5 (most expensive) by silent default. Autonomous dispatch must respect the pickup gate and never resolve to an operator-undesignated model (no-hardcoded-fallback rule).

### PAN-2449 (rank 24)

Planning LEX-1 (GitHub-tracked) spawned planning-min-206 against the wrong project. parseGitHubReposSync ignores projects.yaml whenever GITHUB_REPOS yields any entries. Planning-correctness gap with no warning.

### PAN-2307 (rank 25)

A respawned orchestrator holds the singleton slot but never gets a tick, and remediation lives at the tail of long patrols killed by watchdog churn. Kickoff-on-respawn + early/independent liveness check; merged, verifying on main.

### PAN-2454 (rank 25)

feature/pan-2207 (188 commits, review+tests passed) could not be pushed: the audit rejected an intermediate bump that later commits reverted, though the range net delta was zero. Made the remote branch CONFLICTING, blocking merge on a cleared issue.

### PAN-2423 (rank 25)

Rebuild brought a MYN stack up as overdeck-feature-min-857-* while the verification gate execs myn-feature-min-857-fe-1 — "No such container", work agent needs-you-paused. Derive the project name from the workspace dev script, never a hardcoded prefix.

### PAN-2259 (rank 26)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2293 (rank 26)

PAN-2219 stamped the heartbeat at cycle start but long remediation cycles still exceed the 180s threshold, and stale = immediate restart. Deferral like the health path stops the churn; merged, verifying on main.

### PAN-2406 (rank 26)

Found batch-closing 35 issues. Branches differing only by .pan/records + main merges abort as "does not match merged PR head"; slot/suffixed workspaces leak. Content-level containment (cf. PAN-2311 verifier) needed.

### PAN-2478 (rank 26)

Transient apt-mirror failures reaching packages.microsoft.com turn green PRs into red main after merge (two RUN-58 occurrences), stalling all merges. Retry/cache the browser install so a transient third-party hiccup self-heals.

### PAN-2337 (rank 27)

A mid-flight dist rewrite wounds the running server's spawns with no restart. Boot-pinning the supervisor artifact + atomic staging swap in pan reload closes a real deploy footgun.

### PAN-2351 (rank 27)

Phase 0 of the Overdeck Anywhere epic; blocks every remote-access phase. Scoped tokens + instant revocation + proxy-surviving heartbeats; high security substrate.

### PAN-2165 (rank 28)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2322 (rank 28)

The peer-port guard has an override that a workspace/UAT agent could set to impersonate the production dashboard. Security hardening of the single-dashboard invariant.

### PAN-2428 (rank 28)

Post-rebrand Traefik (overdeck-traefik) shares no network with workspace containers; missing label picks an unreachable devnet IP → 499 timeouts. Fresh MYN workspace must return 200 through Traefik with no manual network connects.

### PAN-2430 (rank 28)

Pre-existing unused-local errors in shared modules block the typecheck gate for unrelated issues. Short-term relax noUnusedLocals; long-term clean up and re-enable. Gate-blocking flake-class debt.

### PAN-807 (rank 29)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2331 (rank 29)

When codex quota runs low, an interactive model-switch modal blocks the agent input loop; many agents froze at once. A narrow launcher/config auto-dismiss is a quick, high-value liveness fix.

### PAN-2333 (rank 30)

Quota exhaustion currently produces a wall of frozen agents and dead-end NEEDS-YOU cards. A proactive quota resource alert + deliberate downshift/pause policy prevents silent agent freezes; broader than PAN-2331.

### PAN-2465 (rank 30)

gh pr list runs in the polyrepo workspace root (no remotes; repos are subdirs). Noisy/ambiguous completion for polyrepo projects; iterate workspace.repos per-forge, or skip with an explicit per-repo note.

### PAN-2421 (rank 30)

Five server route/integration tests time out or assert wrong under the verification gate but pass locally — resource/contention flakes that redden main on otherwise-good merges. Flake-tolerance family (PAN-2373 lane).

### PAN-1520 (rank 31)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1497 (rank 32)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2383 (rank 32)

Pinned in-pipeline (in-progress). First Standing-Crew test-drive; the write-door design (plan.metadata immutability) is the hard bead. High.

### PAN-1650 (rank 33)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1557 (rank 34)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1452 (rank 35)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-2390 (rank 35)

A host-wide memory spike mass-killed every agent session; narrow infra fix (one systemd-run property) with a clear evidence trail. High resilience.

### PAN-2503 (rank 35)

listAllAgentsSync returns 729 rows (only 3 running); closed-issue rows are disposable (their durable state lives in .pan/records) but terminal detection returns 0 terminal issues, so nothing prunes them and the boot-reconciliation + auto-resume hot paths carry dead weight. High substrate-hygiene/perf fix.

### PAN-804 (rank 36)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.

### PAN-1113 (rank 38)

Top-tier item because it has near-term operator value and a clear path to verification.

### PAN-2170 (rank 40)

Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.


<!-- machine-readable; do not hand-edit below this line -->

```json
{
  "version": 1,
  "project": "overdeck",
  "generatedAt": "2026-07-09T08:38:02.226Z",
  "model": "zai/glm-5.2",
  "pass": "incremental",
  "openCount": 592,
  "nodes": [
    {
      "issue": "PAN-806",
      "rank": 6,
      "size": "L",
      "importance": "critical",
      "score": 99,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2395",
      "rank": 9,
      "size": "M",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "One invalid tiered_execution enum poisons every config read — live conversations falsely marked ended, resume/new-conversation blocked.",
      "rationale": "Live incident (2026-07-05): a YAML boolean-coerced enum threw on every config load, falsely ending a live conversation and blocking resume/creation. Data-corrupting + liveness-killing; critical substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1560",
      "rank": 11,
      "size": "M",
      "importance": "critical",
      "score": 99,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2372",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm slot finishes its beads but never runs pan done — deacon can't converge it; permanent stall in the default nudge mode.",
      "rationale": "Still the PAN-2357-family durable-completion swarm gap (empty continue.json) — rank preserved.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2186",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2179",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2169",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 97,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2381",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Three event types missing from the DomainEvent schema union poison the RPC stream — permanent 'Reconnecting…' loop for every tab.",
      "rationale": "Operator-facing outage: an unknown event type kills the whole subscription stream incl. heartbeats; every client reconnect-storms. Stream-boundary validation guard + union fix; critical liveness.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2285",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-agent codex auth.json rots, wedging agents in a silent 401 token_revoked loop; substrate liveness fix.",
      "rationale": "A stale seed-once copy of ~/.codex/auth.json forks the OAuth refresh chain, so respawned codex agents wedge permanently in a 401 retry loop while looking healthy on every surface — the same liveness-illusion class as PAN-2172. A staleness re-seed at spawn plus a troubled-gate trip on repeated token_revoked restores reliable codex dispatch, which is a prerequisite for shipping any gpt-5.5-routed work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1491",
      "rank": 19,
      "size": "M",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2364",
      "rank": 20,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Per-slot failure isolation — one failed-merge slot freezes the ENTIRE issue's swarm behind a manual pan swarm recover.",
      "rationale": "failedMergeBlock is per-issue not per-slot, so swarm parallelism serializes on the first problem. Hardening follow-up to the landed PAN-2357; high.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2379",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verify gate installs deps warn-only + 60s timeout → false verify failures against empty node_modules, blocking swarm convergence.",
      "rationale": "Verified live (RUN-56): concurrent bun installs time out, gates run against empty node_modules, deacon re-fails every patrol. False-fail-that-blocks-convergence; high.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1830",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "High score reflects direct risk to pipeline progress, operator recovery, or autonomous shipping paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2292",
      "rank": 22,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Peer-port guard regression crash-loops every post-guard workspace server, cascading host dashboard restart churn.",
      "rationale": "A dashboard-identity guard refuses PORT=3011 but the devcontainer template still sets it, so every new workspace server crash-loops by design. Regression fix; merged and verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2228",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Two-door delivery hardening now has a PRD + needs-handoff; stays critical substrate tied to zombie-kickoff (PAN-2179).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2168",
      "rank": 23,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2323",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Flywheel respawn after crash starts a blank session instead of resuming the live rich one — orphans operator direction.",
      "rationale": "A crash-respawned orchestrator reads only resume-session.json (written on graceful pause), so it boots blank and silently abandons the operator's in-flight drain-mode session. Resume-from-live-session fix protects orchestration continuity.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1166",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hard prerequisite of the Overdeck Anywhere epic — re-gate /ws/terminal + bind auth before any remote exposure.",
      "rationale": "Delta: 2026-07-04 comment makes this the blocking prerequisite of epic PAN-2350 (Phase 0 / PAN-2351 scoped tokens depend on it); bootstrap path already merged, remaining work is the lockdown. Elevated from low to high.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2307",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Respawned flywheel sits idle with no kickoff; stuck-remediation starved when dashboard lifetime < patrol duration.",
      "rationale": "A respawned orchestrator holds the singleton slot but never gets a tick, and remediation lives at the tail of long patrols killed by watchdog churn. Kickoff-on-respawn + early/independent liveness check; merged, verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2259",
      "rank": 26,
      "size": "M",
      "importance": "critical",
      "score": 89,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2293",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Patrol cycles >180s read as stale heartbeat mid-cycle; watchdog kills the dashboard on first observation.",
      "rationale": "PAN-2219 stamped the heartbeat at cycle start but long remediation cycles still exceed the 180s threshold, and stale = immediate restart. Deferral like the health path stops the churn; merged, verifying on main.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2337",
      "rank": 27,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "In-place build under a live dashboard breaks new PTY-supervisor spawns until restart — pin artifact + atomic reload.",
      "rationale": "A mid-flight dist rewrite wounds the running server's spawns with no restart. Boot-pinning the supervisor artifact + atomic staging swap in pan reload closes a real deploy footgun.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2351",
      "rank": 27,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [
        "PAN-1166"
      ],
      "why": "Overdeck Anywhere P0: scoped access tokens + WS/SSE heartbeats — the security prerequisite that blocks ALL remote exposure.",
      "rationale": "Phase 0 of the Overdeck Anywhere epic; blocks every remote-access phase. Scoped tokens + instant revocation + proxy-surviving heartbeats; high security substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2165",
      "rank": 28,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2322",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Workspace/UAT agent can seize primary :3011 via an override env var — harden the host dashboard-port guard.",
      "rationale": "The peer-port guard has an override that a workspace/UAT agent could set to impersonate the production dashboard. Security hardening of the single-dashboard invariant.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-807",
      "rank": 29,
      "size": "L",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2331",
      "rank": 29,
      "size": "S",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex rate-limit 'switch model?' modal stalls autonomous agents with no auto-dismiss — freezes work.",
      "rationale": "When codex quota runs low, an interactive model-switch modal blocks the agent input loop; many agents froze at once. A narrow launcher/config auto-dismiss is a quick, high-value liveness fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2333",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex weekly-quota exhaustion freezes agents at an unanswerable modal — need resource alert + downshift/pause policy.",
      "rationale": "Quota exhaustion currently produces a wall of frozen agents and dead-end NEEDS-YOU cards. A proactive quota resource alert + deliberate downshift/pause policy prevents silent agent freezes; broader than PAN-2331.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1520",
      "rank": 31,
      "size": "L",
      "importance": "critical",
      "score": 85,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1497",
      "rank": 32,
      "size": "M",
      "importance": "critical",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2383",
      "rank": 32,
      "size": "M",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Editable per-issue Standing Crew toggle on the issue view — upgrade PAN-2378's read-only chip; first tiered-execution dogfood issue.",
      "rationale": "Pinned in-pipeline (in-progress). First Standing-Crew test-drive; the write-door design (plan.metadata immutability) is the hard bead. High.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1650",
      "rank": 33,
      "size": "L",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1557",
      "rank": 34,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1452",
      "rank": 35,
      "size": "M",
      "importance": "critical",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2390",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "systemd-oomd killed overdeck-tmux-server (all 55 agent processes) under host memory pressure — set ManagedOOMPreference=avoid.",
      "rationale": "A host-wide memory spike mass-killed every agent session; narrow infra fix (one systemd-run property) with a clear evidence trail. High resilience.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-804",
      "rank": 36,
      "size": "L",
      "importance": "critical",
      "score": 66,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1113",
      "rank": 38,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2170",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2376",
      "rank": 40,
      "size": "XL",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: CI/CD reliability — flake policy, verify-to-merge convergence, strike/swarm merge hardening, deploy hygiene, review automation.",
      "rationale": "Substrate epic (labeled substrate-improvement). The RUN-55/56 drains proved delivery machinery is the bottleneck; its children are the critical strike/swarm/flake/verify work ranked high above. Container — not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2324",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out label transition fails atomically on missing 'in-planning' label — closed issues keep stale labels.",
      "rationale": "A non-idempotent label transition aborts the whole close-out relabel when an expected label is absent, stranding stale in-review/merged labels on closed issues. Make the transition tolerant/atomic.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2106",
      "rank": 42,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1770",
      "rank": 43,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1766",
      "rank": 44,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2308",
      "rank": 45,
      "size": "M",
      "importance": "high",
      "score": 66,
      "condition": "ok",
      "dependsOn": [
        "PAN-2292"
      ],
      "why": "Migrate stale generated compose files off PORT=3011 + deacon quarantine for deterministic boot refusals.",
      "rationale": "Follow-up hardening to PAN-2292: live workspaces still carry PORT=3011, and the deacon burns restart attempts on deterministic ServerConfig refusals. Migration pass + quarantine stop the churn.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1416",
      "rank": 47,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-955",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2377",
      "rank": 48,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "First-class 'special orders' runs — operator-supplied order book executed with lane semantics (proven manually on RUN-56).",
      "rationale": "Pattern proven manually; makes campaign orchestration mechanical (lane enforcement, pickup-gate release) instead of prose the model must honor. Strategic substrate; high.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2075",
      "rank": 51,
      "size": "XL",
      "importance": "high",
      "score": 77,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "rationale": "Epic container score is derived from open child issues; it is not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-2233",
      "rank": 53,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2232",
      "rank": 54,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2229",
      "rank": 55,
      "size": "M",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2190",
      "rank": 56,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2149",
      "rank": 57,
      "size": "L",
      "importance": "high",
      "score": 76,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2006",
      "rank": 60,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2350",
      "rank": 60,
      "size": "XL",
      "importance": "medium",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: Overdeck Anywhere — remote access, Hermes bridge, mobile, and the shared relay backbone (PRD-backed, phased).",
      "rationale": "Strategic feature epic unifying four remote-access dreams behind three primitives (reachability, identity, remote-safe API). Children are phased; P0 (security) ranks high on its own merit. Container — not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-933",
      "rank": 62,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-334",
      "rank": 63,
      "size": "M",
      "importance": "high",
      "score": 75,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2080",
      "rank": 65,
      "size": "M",
      "importance": "high",
      "score": 74,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2352",
      "rank": 65,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1a: remote dashboard access via Cloudflare Tunnel + Access — the coffee-shop story (operator-only).",
      "rationale": "Phase 1a, mostly ops/config/docs over the P0 scope model. Medium; delivers the headline remote-access UX.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1207",
      "rank": 68,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1198",
      "rank": 69,
      "size": "M",
      "importance": "high",
      "score": 73,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1767",
      "rank": 71,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2189",
      "rank": 72,
      "size": "L",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1828",
      "rank": 73,
      "size": "M",
      "importance": "high",
      "score": 71,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2193",
      "rank": 75,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2255",
      "rank": 76,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [
        "PAN-2228"
      ],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Top-tier item because it has near-term operator value and a clear path to verification.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1618",
      "rank": 77,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1209",
      "rank": 78,
      "size": "M",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2353",
      "rank": 80,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1b: Hermes external-agent bridge — scoped API over Fly 6PN (first external-service integration).",
      "rationale": "Phase 1b, greenfield; thin routes over existing doors, no new write paths. Medium.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2188",
      "rank": 81,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Substrate or architecture work ranks high because stable orchestration is the prerequisite for shipping other backlog items.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1246",
      "rank": 84,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1219",
      "rank": 85,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2354",
      "rank": 85,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P1c: needs-you push notification bridge (ntfy first, Web Push later).",
      "rationale": "Phase 1c; event-store subscriber → ntfy, needs-you only and batched. Medium.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1217",
      "rank": 86,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-813",
      "rank": 87,
      "size": "M",
      "importance": "high",
      "score": 67,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2358",
      "rank": 88,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restore PAN-1535 hardening in transformMessageForHarness (rewritten during conversations.ts decomposition) — affects non-claude harnesses.",
      "rationale": "A behavior-preserving move silently rewrote the attachment-stripping logic (no escaping/lookbehind); CI green didn't prove preservation. Medium correctness regression for pi/kimi/codex.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2202",
      "rank": 89,
      "size": "L",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2288",
      "rank": 90,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Lossless auto-migration of dirty-founded tmux servers + boot-time ensure call (PAN-1798 follow-up).",
      "rationale": "New foundings land under the managed systemd unit but existing dirty-founded idle servers persist until reboot. Zero-session auto-migration at pan up + a boot-time ensure call finish the managed-tmux transition.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1444",
      "rank": 91,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1440",
      "rank": 92,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1436",
      "rank": 93,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-262",
      "rank": 94,
      "size": "M",
      "importance": "high",
      "score": 65,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2240",
      "rank": 95,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2355",
      "rank": 95,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [
        "PAN-2351",
        "PAN-2352"
      ],
      "why": "Overdeck Anywhere P2: mobile PWA — Needs-You feed, conversation view, pipeline board, Web Push.",
      "rationale": "Phase 2 mobile surface in the existing React codebase; PWA-before-native decision. Medium; large feature.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1912",
      "rank": 97,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1556",
      "rank": 98,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1433",
      "rank": 99,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1330",
      "rank": 100,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2334",
      "rank": 100,
      "size": "M",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Write a Definition of Ready + wire it into the pickup gate to catch junk issues before an agent is spawned.",
      "rationale": "Nothing flagged the retired audit-campaign issues as not-ready, so they consumed an agent and slammed the quota wall. A DoR doc + intake scoring is a process substrate improvement that prevents recurrence.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-675",
      "rank": 101,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-629",
      "rank": 102,
      "size": "M",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2392",
      "rank": 105,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [
        "PAN-2387",
        "PAN-2388",
        "PAN-2385"
      ],
      "why": "Standing Crew cost panel — per-member roster with cost, tokens, verdicts, escalations (mockup included).",
      "rationale": "Beautiful UI for tuning tier configs from evidence; mockup is operator-reviewed. Medium; depends on the cost/parser fixes landing first.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1454",
      "rank": 106,
      "size": "L",
      "importance": "high",
      "score": 62,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2059",
      "rank": 107,
      "size": "XL",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1889",
      "rank": 108,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1578",
      "rank": 110,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1558",
      "rank": 111,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1254",
      "rank": 112,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1253",
      "rank": 113,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-630",
      "rank": 114,
      "size": "M",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2394",
      "rank": 115,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Incident: conv-* agent-dir cleanup destroyed ohmypi/codex conversation transcripts — 'no saved history'.",
      "rationale": "Data-loss incident; the stop-fix + missing-transcript indicator landed on main, but the deacon stale-agent purge is flagged as the next-dangerous auto-deletion path to audit. Medium follow-up.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2079",
      "rank": 116,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2078",
      "rank": 117,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2077",
      "rank": 118,
      "size": "L",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1451",
      "rank": 119,
      "size": "L",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1218",
      "rank": 120,
      "size": "M",
      "importance": "high",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1561",
      "rank": 121,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1538",
      "rank": 122,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1357",
      "rank": 123,
      "size": "M",
      "importance": "high",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1915",
      "rank": 126,
      "size": "M",
      "importance": "high",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2027",
      "rank": 127,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1913",
      "rank": 128,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1544",
      "rank": 129,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1525",
      "rank": 130,
      "size": "L",
      "importance": "high",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2356",
      "rank": 130,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "needs-refinement",
      "dependsOn": [
        "PAN-2351"
      ],
      "why": "Overdeck Anywhere P3: relay service — outbound-only daemon, GitHub OAuth, push origin, multi-tenant front door (product phase).",
      "rationale": "Phase 3 product phase (~$2-5/mo) — build when multi-machine/multi-user demand is real, not before; also the substrate for PAN-658. Medium, needs-refinement (cost/infra decisions deferred).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1504",
      "rank": 131,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1196",
      "rank": 132,
      "size": "M",
      "importance": "high",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1142",
      "rank": 133,
      "size": "M",
      "importance": "high",
      "score": 46,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1435",
      "rank": 134,
      "size": "M",
      "importance": "high",
      "score": 43,
      "condition": "ok",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-578",
      "rank": 135,
      "size": "M",
      "importance": "high",
      "score": 41,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Closes security exposure in local/operator configuration.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1424",
      "rank": 136,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1313",
      "rank": 137,
      "size": "L",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1311",
      "rank": 138,
      "size": "M",
      "importance": "high",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Substrate work; improves the foundation required for reliable shipping.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2252",
      "rank": 140,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "rationale": "The body documents a production dashboard impersonation incident, so identity checks rank as critical substrate hardening.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1755",
      "rank": 141,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1691",
      "rank": 142,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1627",
      "rank": 143,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1572",
      "rank": 144,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1437",
      "rank": 145,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1245",
      "rank": 146,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1208",
      "rank": 147,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1154",
      "rank": 148,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-687",
      "rank": 150,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2287",
      "rank": 150,
      "size": "XS",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Every supervisor.log line is written twice (appendFile + stdio redirect) — misled incident triage.",
      "rationale": "The launcher redirects stdout to the same file log() appends to, doubling every line and once suggesting a dueling-supervisor. Drop one write path; small cleanup with real triage value.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1824",
      "rank": 151,
      "size": "M",
      "importance": "medium",
      "score": 59,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2280",
      "rank": 152,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2252"
      ],
      "why": "Stops resumed conversations from silently losing transcript writes.",
      "rationale": "The new body ties transcript loss to black-holed dashboard hooks and live wedges, making it a critical durability blocker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1937",
      "rank": 154,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1897",
      "rank": 155,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1816",
      "rank": 156,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1674",
      "rank": 157,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1672",
      "rank": 158,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1490",
      "rank": 160,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1446",
      "rank": 161,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1438",
      "rank": 162,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1392",
      "rank": 163,
      "size": "L",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1386",
      "rank": 164,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1173",
      "rank": 167,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1131",
      "rank": 168,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1130",
      "rank": 169,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1129",
      "rank": 170,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1027",
      "rank": 171,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-886",
      "rank": 176,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-681",
      "rank": 177,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-658",
      "rank": 178,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [
        "PAN-2356"
      ],
      "why": "Shared Sessions v0 — Phase 4 of Overdeck Anywhere, sequenced after the #2356 relay (plain WSS rooms, WebRTC deferred).",
      "rationale": "Delta: linked as Phase 4 of epic PAN-2350; transport decision narrowed to plain WSS over the #2356 relay. Large later-phase feature, rank held.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-324",
      "rank": 180,
      "size": "M",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2319",
      "rank": 180,
      "size": "S",
      "importance": "low",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "'COST LIMIT REACHED for undefined' spams every cycle — fix undefined subject, throttle, configurable default.",
      "rationale": "A cost-monitor log emits an undefined daily_total subject every cycle. Low-risk noise reduction: fix the subject, throttle the log, consolidate the default.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1122",
      "rank": 181,
      "size": "M",
      "importance": "medium",
      "score": 57,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1565",
      "rank": 182,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1461",
      "rank": 183,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1128",
      "rank": 184,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-900",
      "rank": 186,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-764",
      "rank": 187,
      "size": "M",
      "importance": "medium",
      "score": 54,
      "condition": "ok",
      "dependsOn": [],
      "why": "GitHub quota failures block close, edit, and orchestration paths.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1234",
      "rank": 190,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1232",
      "rank": 191,
      "size": "M",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1837",
      "rank": 194,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1643",
      "rank": 197,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1641",
      "rank": 198,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1553",
      "rank": 199,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1482",
      "rank": 200,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2295",
      "rank": 200,
      "size": "XL",
      "importance": "medium",
      "score": 50,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Built-in web-browser surface (openable like terminal/Codex) + native Agentation integration — needs design.",
      "rationale": "A large, ambitious feature: a first-class browser panel plus Agentation annotation→agent context wiring. Real product value but needs an embedding-model and security design decision before it is workable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-771",
      "rank": 201,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-752",
      "rank": 202,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-702",
      "rank": 203,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-466",
      "rank": 204,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-463",
      "rank": 205,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2085",
      "rank": 206,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1986",
      "rank": 207,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1958",
      "rank": 208,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1761",
      "rank": 209,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1655",
      "rank": 210,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1356",
      "rank": 211,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-777",
      "rank": 212,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-576",
      "rank": 213,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-468",
      "rank": 214,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-452",
      "rank": 215,
      "size": "M",
      "importance": "medium",
      "score": 51,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2069",
      "rank": 216,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2005",
      "rank": 217,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1951",
      "rank": 218,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1862",
      "rank": 219,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1852",
      "rank": 220,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1775",
      "rank": 221,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1696",
      "rank": 223,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1610",
      "rank": 224,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1102",
      "rank": 225,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-783",
      "rank": 226,
      "size": "L",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1983",
      "rank": 227,
      "size": "L",
      "importance": "medium",
      "score": 49,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2245",
      "rank": 228,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2244",
      "rank": 229,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2243",
      "rank": 230,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2242",
      "rank": 231,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2241",
      "rank": 232,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2237",
      "rank": 233,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1795",
      "rank": 234,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1673",
      "rank": 235,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1624",
      "rank": 236,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1530",
      "rank": 238,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1449",
      "rank": 239,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1445",
      "rank": 240,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1240",
      "rank": 241,
      "size": "L",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1150",
      "rank": 242,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1149",
      "rank": 243,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1068",
      "rank": 244,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1042",
      "rank": 245,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-932",
      "rank": 246,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-304",
      "rank": 247,
      "size": "M",
      "importance": "medium",
      "score": 48,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1896",
      "rank": 248,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1577",
      "rank": 249,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1533",
      "rank": 250,
      "size": "M",
      "importance": "medium",
      "score": 46,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2347",
      "rank": 250,
      "size": "M",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refresh AGENT-STATE-PLANES.md into the definitive, source-verified state-storage reference.",
      "rationale": "Docs-refresh: make the primary agent-state reference accurate against live source (overdeck.db schema, write paths, rebuild commands). Useful but low shipping impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2212",
      "rank": 252,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2211",
      "rank": 253,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2210",
      "rank": 254,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2209",
      "rank": 255,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2344",
      "rank": 255,
      "size": "M",
      "importance": "low",
      "score": 39,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite KANBAN-MODEL.md to match the current pipeline phases, gates, and two-door state model.",
      "rationale": "Docs-refresh of the lifecycle model doc against what the dashboard actually renders. Low shipping impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2197",
      "rank": 257,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2032",
      "rank": 259,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2004",
      "rank": 260,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2345",
      "rank": 260,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refresh pan-done.md to document the current done→rebase→push→PR→review chain and verify-on-main pause.",
      "rationale": "Docs-refresh so a work agent reading pan-done.md gets the real flow; fix the weak MISSION-CONTROL MERGE-button link.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1995",
      "rank": 261,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1990",
      "rank": 262,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2343",
      "rank": 262,
      "size": "S",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rewrite MISSION-CONTROL.md against current dashboard architecture and state-label computation.",
      "rationale": "Docs-refresh: the doc is stale/thin and used panopticon.db naming. Low shipping impact but part of the docs sweep.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1988",
      "rank": 263,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1985",
      "rank": 264,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1980",
      "rank": 265,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2346",
      "rank": 265,
      "size": "S",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Refresh AGENT_TYPES_INDEX.md to cover the current agent-ID patterns and role/ceiling semantics.",
      "rationale": "Docs-refresh of the agent taxonomy index against src/lib/agents.ts. Low shipping impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1967",
      "rank": 266,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1966",
      "rank": 267,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1965",
      "rank": 268,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2348",
      "rank": 268,
      "size": "S",
      "importance": "low",
      "score": 36,
      "condition": "ok",
      "dependsOn": [
        "PAN-2347"
      ],
      "why": "Migrate still-relevant STATE-STORAGE-AUDIT.md content into living docs, then delete the frozen audit.",
      "rationale": "Docs-cleanup: capture the ~/.overdeck surface inventory + any uncovered facts into living docs, then remove the noise. Depends on the AGENT-STATE-PLANES refresh.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1914",
      "rank": 270,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1895",
      "rank": 271,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1874",
      "rank": 272,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1846",
      "rank": 273,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1844",
      "rank": 274,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1840",
      "rank": 275,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1774",
      "rank": 276,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1773",
      "rank": 277,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1758",
      "rank": 278,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1751",
      "rank": 279,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1750",
      "rank": 280,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1748",
      "rank": 281,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1740",
      "rank": 282,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1735",
      "rank": 284,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1728",
      "rank": 286,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1720",
      "rank": 288,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1676",
      "rank": 289,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1668",
      "rank": 290,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1667",
      "rank": 291,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1666",
      "rank": 292,
      "size": "XL",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Container; ranks by child impact, not directly pickable.",
      "gate": "auto",
      "planning": "skip",
      "isEpic": true
    },
    {
      "issue": "PAN-1657",
      "rank": 293,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1656",
      "rank": 294,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1581",
      "rank": 298,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1542",
      "rank": 299,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1432",
      "rank": 301,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1244",
      "rank": 302,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1165",
      "rank": 303,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "rationale": "Lightweight-review-path design refreshed but remains a multi-sketch enhancement needing a chosen approach; medium hold.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1147",
      "rank": 304,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1136",
      "rank": 305,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1133",
      "rank": 306,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1126",
      "rank": 307,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1124",
      "rank": 308,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1121",
      "rank": 309,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1066",
      "rank": 311,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1037",
      "rank": 312,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-943",
      "rank": 313,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-938",
      "rank": 314,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-908",
      "rank": 315,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-833",
      "rank": 317,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-832",
      "rank": 318,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-778",
      "rank": 319,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-775",
      "rank": 320,
      "size": "L",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-769",
      "rank": 321,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-736",
      "rank": 322,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-735",
      "rank": 323,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-727",
      "rank": 324,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-709",
      "rank": 325,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-678",
      "rank": 326,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-624",
      "rank": 327,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-622",
      "rank": 328,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-613",
      "rank": 329,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-606",
      "rank": 330,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-604",
      "rank": 331,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-603",
      "rank": 332,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-568",
      "rank": 333,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-538",
      "rank": 334,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-483",
      "rank": 335,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-480",
      "rank": 336,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-476",
      "rank": 337,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-471",
      "rank": 338,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-637",
      "rank": 342,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents inert agents that look healthy but do no work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-531",
      "rank": 343,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-38",
      "rank": 344,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "stale",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-37",
      "rank": 345,
      "size": "M",
      "importance": "medium",
      "score": 44,
      "condition": "stale",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1868",
      "rank": 346,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1488",
      "rank": 347,
      "size": "M",
      "importance": "medium",
      "score": 42,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2282",
      "rank": 349,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "rationale": "New body shows non-Claude handoff transcripts use a missing resolver surface, so it ranks with the session-visibility blockers.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2084",
      "rank": 350,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2046",
      "rank": 351,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2034",
      "rank": 352,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2024",
      "rank": 353,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1854",
      "rank": 354,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1853",
      "rank": 355,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1646",
      "rank": 356,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1623",
      "rank": 358,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1571",
      "rank": 360,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1552",
      "rank": 361,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1545",
      "rank": 362,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1485",
      "rank": 363,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1473",
      "rank": 364,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1123",
      "rank": 365,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-949",
      "rank": 366,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-818",
      "rank": 367,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-772",
      "rank": 368,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-747",
      "rank": 369,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-738",
      "rank": 370,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-649",
      "rank": 371,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-565",
      "rank": 372,
      "size": "M",
      "importance": "medium",
      "score": 41,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1776",
      "rank": 373,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1685",
      "rank": 374,
      "size": "L",
      "importance": "medium",
      "score": 40,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Prevents workspace servers from impersonating production dashboard.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1164",
      "rank": 377,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1101",
      "rank": 378,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-947",
      "rank": 379,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-608",
      "rank": 380,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-247",
      "rank": 381,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-113",
      "rank": 382,
      "size": "M",
      "importance": "medium",
      "score": 40,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2070",
      "rank": 384,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2068",
      "rank": 385,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1769",
      "rank": 386,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1711",
      "rank": 387,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "rationale": "Older event-loop-stall symptom report now superseded by PAN-2318's comprehensive PRD fix; kept low as a duplicate lens.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1683",
      "rank": 388,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1469",
      "rank": 389,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1227",
      "rank": 390,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1226",
      "rank": 391,
      "size": "L",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-633",
      "rank": 392,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1654",
      "rank": 394,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-853",
      "rank": 395,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-810",
      "rank": 396,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-793",
      "rank": 397,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-774",
      "rank": 398,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-663",
      "rank": 399,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-589",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2335",
      "rank": 400,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Find-only categorized junk-backlog review document; operator-gated, keep on backlog (do NOT action).",
      "rationale": "Operator explicitly scoped this to produce a review document only and to stay on the backlog un-planned until they sign off. Gated and not for pickup.",
      "gate": "blocked",
      "planning": "skip"
    },
    {
      "issue": "PAN-454",
      "rank": 401,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-407",
      "rank": 402,
      "size": "M",
      "importance": "low",
      "score": 37,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2266",
      "rank": 403,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2213",
      "rank": 404,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2201",
      "rank": 405,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2195",
      "rank": 406,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2091",
      "rank": 407,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2083",
      "rank": 408,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2082",
      "rank": 409,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2065",
      "rank": 410,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2045",
      "rank": 411,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2035",
      "rank": 412,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2033",
      "rank": 413,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2031",
      "rank": 414,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2030",
      "rank": 415,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2029",
      "rank": 416,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2028",
      "rank": 417,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2026",
      "rank": 418,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2025",
      "rank": 419,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1999",
      "rank": 420,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1991",
      "rank": 421,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1987",
      "rank": 422,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "rationale": "Re-verified on updatedAt tick; body still self-declares low-priority cleanup ('not blocking anything'), so rank/score are unchanged.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1968",
      "rank": 423,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1949",
      "rank": 427,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1936",
      "rank": 428,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1926",
      "rank": 429,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1916",
      "rank": 430,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1910",
      "rank": 431,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1907",
      "rank": 432,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1906",
      "rank": 433,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1839",
      "rank": 434,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1782",
      "rank": 435,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1754",
      "rank": 436,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1710",
      "rank": 438,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1671",
      "rank": 439,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1669",
      "rank": 440,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1640",
      "rank": 441,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1592",
      "rank": 442,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1550",
      "rank": 444,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1524",
      "rank": 446,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1489",
      "rank": 448,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1481",
      "rank": 449,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1480",
      "rank": 450,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1479",
      "rank": 451,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1474",
      "rank": 452,
      "size": "S",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1442",
      "rank": 453,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1325",
      "rank": 454,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1242",
      "rank": 455,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1222",
      "rank": 457,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1153",
      "rank": 459,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1116",
      "rank": 460,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1065",
      "rank": 461,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1064",
      "rank": 462,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1063",
      "rank": 463,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1060",
      "rank": 464,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1049",
      "rank": 465,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1041",
      "rank": 466,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-962",
      "rank": 467,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-958",
      "rank": 468,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-944",
      "rank": 470,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-927",
      "rank": 471,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-903",
      "rank": 473,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-902",
      "rank": 474,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-863",
      "rank": 475,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-790",
      "rank": 477,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-786",
      "rank": 478,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-773",
      "rank": 479,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-765",
      "rank": 480,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-762",
      "rank": 481,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-751",
      "rank": 482,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-750",
      "rank": 483,
      "size": "L",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-749",
      "rank": 484,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-730",
      "rank": 485,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-660",
      "rank": 487,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-623",
      "rank": 488,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-607",
      "rank": 489,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-570",
      "rank": 491,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-564",
      "rank": 492,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-554",
      "rank": 493,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-548",
      "rank": 495,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-546",
      "rank": 496,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-543",
      "rank": 497,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-537",
      "rank": 498,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-532",
      "rank": 499,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-465",
      "rank": 500,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-461",
      "rank": 501,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-459",
      "rank": 502,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-450",
      "rank": 503,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-438",
      "rank": 504,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-399",
      "rank": 505,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-198",
      "rank": 506,
      "size": "M",
      "importance": "low",
      "score": 35,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-743",
      "rank": 509,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-701",
      "rank": 510,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-175",
      "rank": 511,
      "size": "M",
      "importance": "low",
      "score": 33,
      "condition": "stale",
      "dependsOn": [],
      "why": "Restores conversation/session visibility across non-Claude harnesses.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2008",
      "rank": 512,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1984",
      "rank": 513,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-49",
      "rank": 514,
      "size": "M",
      "importance": "low",
      "score": 32,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-826",
      "rank": 516,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Shrinks oversized substrate files so future changes stay tractable.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-802",
      "rank": 517,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-700",
      "rank": 518,
      "size": "M",
      "importance": "low",
      "score": 31,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1653",
      "rank": 519,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-244",
      "rank": 521,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2073",
      "rank": 522,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2072",
      "rank": 523,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2071",
      "rank": 524,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2067",
      "rank": 525,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1878",
      "rank": 526,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1443",
      "rank": 527,
      "size": "L",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1135",
      "rank": 528,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1117",
      "rank": 529,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-961",
      "rank": 530,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-634",
      "rank": 531,
      "size": "M",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2037",
      "rank": 532,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-2002",
      "rank": 533,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1918",
      "rank": 534,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1483",
      "rank": 535,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1152",
      "rank": 536,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1151",
      "rank": 537,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1051",
      "rank": 538,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1040",
      "rank": 539,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-984",
      "rank": 540,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-901",
      "rank": 541,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-791",
      "rank": 543,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-654",
      "rank": 544,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-591",
      "rank": 545,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-571",
      "rank": 546,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "ok",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-298",
      "rank": 547,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-297",
      "rank": 548,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-293",
      "rank": 549,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-283",
      "rank": 550,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-265",
      "rank": 551,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-255",
      "rank": 552,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-252",
      "rank": 553,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-190",
      "rank": 554,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-180",
      "rank": 555,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-177",
      "rank": 556,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-176",
      "rank": 557,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-47",
      "rank": 558,
      "size": "L",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Hardens the pipeline paths that ship all other work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-43",
      "rank": 559,
      "size": "M",
      "importance": "low",
      "score": 27,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2066",
      "rank": 560,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-1223",
      "rank": 561,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-898",
      "rank": 562,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-817",
      "rank": 563,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-797",
      "rank": 564,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-713",
      "rank": 565,
      "size": "M",
      "importance": "low",
      "score": 25,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-245",
      "rank": 567,
      "size": "M",
      "importance": "low",
      "score": 22,
      "condition": "stale",
      "dependsOn": [],
      "why": "Bug fix with direct operator or pipeline reliability impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-1684",
      "rank": 568,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-674",
      "rank": 569,
      "size": "M",
      "importance": "low",
      "score": 20,
      "condition": "ok",
      "dependsOn": [],
      "why": "Documentation improvement; useful but lower shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2074",
      "rank": 571,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-924",
      "rank": 572,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-646",
      "rank": 573,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "interactive"
    },
    {
      "issue": "PAN-299",
      "rank": 574,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-294",
      "rank": 575,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-277",
      "rank": 576,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-271",
      "rank": 577,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-258",
      "rank": 578,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-243",
      "rank": 579,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-228",
      "rank": 580,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-227",
      "rank": 581,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-178",
      "rank": 582,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-155",
      "rank": 583,
      "size": "L",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-146",
      "rank": 584,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-106",
      "rank": 585,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-104",
      "rank": 586,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-77",
      "rank": 587,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-55",
      "rank": 588,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-54",
      "rank": 589,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-44",
      "rank": 590,
      "size": "M",
      "importance": "low",
      "score": 17,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-51",
      "rank": 591,
      "size": "M",
      "importance": "low",
      "score": 10,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-249",
      "rank": 592,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-241",
      "rank": 593,
      "size": "L",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-52",
      "rank": 594,
      "size": "M",
      "importance": "low",
      "score": 9,
      "condition": "stale",
      "dependsOn": [],
      "why": "Routine backlog item; rank reflects current shipping leverage.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2500",
      "rank": 11,
      "size": "XL",
      "importance": "critical",
      "score": 96,
      "condition": "ok",
      "dependsOn": [],
      "why": "Memory-aware resource governor — autonomous resume skips the RAM admission gate the HTTP spawn path enforces; OOM root cause (host reboot...",
      "rationale": "Root cause of two host OOM/reboot events: the autonomous resume/dispatch path skips the memory admission gate the HTTP spawn path enforces. A data-corrupting + liveness-killing substrate fix for the shipping pipeline itself; epic PAN-1666 child. Now in-pipeline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2469",
      "rank": 12,
      "size": "L",
      "importance": "critical",
      "score": 95,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm has no issue-level assembly owner — finished swarm work sits invisible-to-every-patrol; root cause of PAN-2388/2383/399 stalls.",
      "rationale": "5-whys root cause: swarm slots complete individually but nothing owns the all-slots-done transition to assemble/verify/review. Days lost to this; the deacon logs a spammed symptom every 60s. Critical substrate for swarm convergence.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2473",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "State-only verdict commits invalidate fresh review/test verdicts — convoys force-respawn in a churn loop (state-plane policy violation).",
      "rationale": "Every verdict write lands a state-plane commit, HEAD moves, staleness machinery treats the fresh verdict as stale and re-dispatches. Each spurious cycle burns a full review convoy (~20-40 min + tokens). State-plane predicate missing from the verdict comparison. In-pipeline (merged/verifying).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2417",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Self-feeding verdict loop — recording a review/test pass as a chore(state) commit invalidates the pass it records; readyForMerge never ho...",
      "rationale": "Sibling of PAN-2473: PAN-2402 earned review+test+readyForMerge three times in 90 min and lost it within seconds each time. The verdict-recording commit is itself the staleness trigger. Critical merge-readiness blocker. In-pipeline (merged/verifying).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2461",
      "rank": 14,
      "size": "L",
      "importance": "critical",
      "score": 94,
      "condition": "ok",
      "dependsOn": [],
      "why": "Verification-gate needs-you pause + feedback_delivery_needs_you deadlock — the gate pauses the only delivery target, then parks the issue...",
      "rationale": "The gate creates the condition (agent paused) that makes feedback delivery impossible; nothing resumes or re-verifies when the env heals. Six issues parked simultaneously. Plus no local flake tolerance and container-down gates mislabel as lint failures. Critical pipeline-flow blocker.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2486",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex rate-limit model-switch dialog wedges agents AND its default silently downgrades to gpt-5.4-mini (~3h silent fleet stall).",
      "rationale": "strike + 2 work agents wedged 1-3h on an interactive dialog no automation dismisses; dismissing via the delivery door confirmed the DEFAULT (switch to mini), silently downgrading substrate-coding sessions. Liveness + invisible quality risk.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2498",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Swarm failed WORK slots (dead agent) are never auto-redispatched OR surfaced — swarms silently stall at partial completion.",
      "rationale": "A failed work slot (missing-agent/vanished-session) is only logged then dropped; its item is never reset to pending and its dead branch holds the slot index, so dispatchNextWave can never refill. Permanent silent stall (PAN-399 sat 1/3 for a day). Critical swarm-liveness gap.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2467",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 93,
      "condition": "ok",
      "dependsOn": [],
      "why": "Multi-repo merge train merges only one repo — strands sibling repos branches; silent partial delivery of a multi-repo feature to prod.",
      "rationale": "MIN-857 was treated as merged/done after only the frontend repo merged; the api branch with UAT-critical commits was left unmerged with no MR. Correctness gap that can ship half a feature to production — a multi-repo train must merge every participating repo before done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2485",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [
        "PAN-2469"
      ],
      "why": "Dead-session swarm slot (failed, session dead) has NO automatic recovery — coordinator never requeues and pan swarm recover refuses non-m...",
      "rationale": "A dead-session failed slot is a terminal classification with no consumer; recover only handles FailedMergeBlock. Required: coordinator owns failed slots (requeue + gc dead branch), recover covers non-merge failures, gcMergedSlots reaps promptly. Part of PAN-2469 state machine.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2422",
      "rank": 17,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Rebuilding dist under a live server breaks lazy chunk imports — first click on a not-yet-loaded path crashes with module-not-found.",
      "rationale": "Intervening npm run build deletes old hashed chunks the live server still resolves at call time. Same deploy-reliability family as PAN-2337/PAN-2380. Fix: versioned dist dir + atomic symlink flip, or eager boot-time imports.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2409",
      "rank": 17,
      "size": "L",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "Enforce the workspace boundary — work agents edited the PRIMARY checkout by absolute path (PAN-2204 class, reproduced 3x on 2026-07-06).",
      "rationale": "Nothing blocks a work agent from writing outside its workspace; three Haiku agents put real implementation into primary, so review evaluated an incomplete branch. The standing write-to-main hazard, now reproduced. Needs a hard write-boundary.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2495",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2487 ci-green merge skip bypassed the CI-green gate and landed a red-required-check change on main.",
      "rationale": "A merge path that can skip CI-green let a PR with a red required test check land on main, reddening main (RUN-58: ~45 min P0 recovery). A skip may only apply to non-required checks; the no-loss audit must be a required blocking gate. Critical gate-integrity fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2466",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out/record writer clobbers closeOut.usage with EMPTY data — local cost history lost on the recurring close path.",
      "rationale": "Twice in a day the local per-issue records for just-closed issues were rewritten with empty byStage/totals/merges while the remote carried real usage. Silently destroys exactly the data the cost-visibility program (PAN-2387/2388) builds. Writer must read-modify-write closeOut.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2479",
      "rank": 20,
      "size": "S",
      "importance": "high",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "claude-code work-agent launcher passes a role file path to --agent (which wants a registered name) — every claude-code work agent exits b...",
      "rationale": "spawnAgent builds --agent roles/work.md, but --agent takes a registered agent name; claude exits 1 with \"not found\" that the supervisor swallows as a 30s ready-timeout. Surfaces when routing lands on claude-code (kimi). Small, high-leverage fix. In-pipeline (merged/verifying).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2408",
      "rank": 21,
      "size": "M",
      "importance": "high",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start --auto commits the spec to main AFTER creating the worktree — the agent workspace lacks its own spec, triggering wrong-workspac...",
      "rationale": "Each worktree (branched pre-spec) lacks its .pan/specs/*.vbrief.json while later siblings have it; agents conclude the spec is in the wrong workspace and re-anchor on primary (the direct cause of PAN-2409). Ordering fix: commit spec before worktree creation.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2416",
      "rank": 22,
      "size": "S",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Codex agents can wedge on the Codex CLI first-run/consent screen — spawn must pre-accept non-interactively.",
      "rationale": "A review agent sat ~20 min on the onboarding \"Press enter to continue\" screen with review_status failed and no notes. Per-session first-run dependent. Spawn path must guarantee no interactive onboarding.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2414",
      "rank": 22,
      "size": "M",
      "importance": "high",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Context-overflow recovery is inconsistent — some agents get the compact-respawn, others hit rotation refusal and die holding uncommitted ...",
      "rationale": "Two agents hit ~100% context the same afternoon with opposite outcomes (PAN-1781 respawn vs PAN-1980 refusal + death with 2 modified files). One deliberate policy for overflow recovery; the PAN-1781 fix must apply uniformly.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2475",
      "rank": 23,
      "size": "S",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan admin db restore-verdicts hangs indefinitely on real runs (dry-run fine) — the verdict-restore repair door is unusable interactively.",
      "rationale": "Every non-dry-run invocation hung until killed (60/90/240s) while dry-run completes in seconds; write phase blocks on a lock or unsettled top-level await. Same hang signature seen in pan swarm resume / pan review reset — likely one shared CLI-never-exits root.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2451",
      "rank": 23,
      "size": "M",
      "importance": "high",
      "score": 85,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agent stranded behind commit-msg gate after overflow-restart + auto-commit + merge-main (non-issue-ref commits).",
      "rationale": "Branch 108 commits ahead with merge/auto-commit/overflow-checkpoint messages that fail the issue-ref gate; the agent stalls pre-submit and the deacon does not re-engage a pre-submit-frozen work agent.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2445",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "Deacon lifecycle patrol auto-dispatches PLANNING for stale planning-state issues — off-book, and staffed from Fable when no model is reco...",
      "rationale": "With auto_pickup off and an active order book, the patrol still dispatched planning on claude-fable-5 (most expensive) by silent default. Autonomous dispatch must respect the pickup gate and never resolve to an operator-undesignated model (no-hardcoded-fallback rule).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2449",
      "rank": 24,
      "size": "M",
      "importance": "high",
      "score": 84,
      "condition": "ok",
      "dependsOn": [],
      "why": "GITHUB_REPOS env var shadows projects.yaml github_repo — unknown IDs fall through to Linear and plan the WRONG issue.",
      "rationale": "Planning LEX-1 (GitHub-tracked) spawned planning-min-206 against the wrong project. parseGitHubReposSync ignores projects.yaml whenever GITHUB_REPOS yields any entries. Planning-correctness gap with no warning.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2454",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "Ratchet audit fails per-commit on push ranges whose NET baseline delta is zero — strands finished, fully-cleared branches.",
      "rationale": "feature/pan-2207 (188 commits, review+tests passed) could not be pushed: the audit rejected an intermediate bump that later commits reverted, though the range net delta was zero. Made the remote branch CONFLICTING, blocking merge on a cleared issue.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2423",
      "rank": 25,
      "size": "M",
      "importance": "high",
      "score": 83,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan workspace rebuild hardcodes the overdeck- compose prefix — mismatches project templates and verification container names.",
      "rationale": "Rebuild brought a MYN stack up as overdeck-feature-min-857-* while the verification gate execs myn-feature-min-857-fe-1 — \"No such container\", work agent needs-you-paused. Derive the project name from the workspace dev script, never a hardcoded prefix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2406",
      "rank": 26,
      "size": "M",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "Close-out gaps: verify-merged rejects record-only deltas; slot/suffixed worktrees never torn down; teardown abort fires after worktree re...",
      "rationale": "Found batch-closing 35 issues. Branches differing only by .pan/records + main merges abort as \"does not match merged PR head\"; slot/suffixed workspaces leak. Content-level containment (cf. PAN-2311 verifier) needed.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2478",
      "rank": 26,
      "size": "S",
      "importance": "high",
      "score": 82,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI flake: Playwright browser install fails on packages.microsoft.com apt (NOSPLIT) — red-mains legit merges.",
      "rationale": "Transient apt-mirror failures reaching packages.microsoft.com turn green PRs into red main after merge (two RUN-58 occurrences), stalling all merges. Retry/cache the browser install so a transient third-party hiccup self-heals.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2428",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 81,
      "condition": "ok",
      "dependsOn": [],
      "why": "MYN workspace Traefik routing broken post-rebrand — legacy panopticon network + missing traefik.docker.network label make UAT unreachable.",
      "rationale": "Post-rebrand Traefik (overdeck-traefik) shares no network with workspace containers; missing label picks an unreachable devnet IP → 499 timeouts. Fresh MYN workspace must return 200 through Traefik with no manual network connects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2430",
      "rank": 28,
      "size": "M",
      "importance": "high",
      "score": 80,
      "condition": "ok",
      "dependsOn": [],
      "why": "Frontend typecheck fails with dozens of pre-existing unused-local errors — blocks verification for any frontend-scoped issue.",
      "rationale": "Pre-existing unused-local errors in shared modules block the typecheck gate for unrelated issues. Short-term relax noUnusedLocals; long-term clean up and re-enable. Gate-blocking flake-class debt.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2465",
      "rank": 30,
      "size": "S",
      "importance": "high",
      "score": 79,
      "condition": "ok",
      "dependsOn": [
        "PAN-2461"
      ],
      "why": "pan done PR lookup fails at MYN polyrepo root — \"no git remotes found\" makes completion exit nonzero.",
      "rationale": "gh pr list runs in the polyrepo workspace root (no remotes; repos are subdirs). Noisy/ambiguous completion for polyrepo projects; iterate workspace.repos per-forge, or skip with an explicit per-repo note.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2421",
      "rank": 30,
      "size": "M",
      "importance": "high",
      "score": 78,
      "condition": "ok",
      "dependsOn": [],
      "why": "Dashboard server route tests flake under full-suite verification load (timeouts/assert mismatches) but pass in isolation.",
      "rationale": "Five server route/integration tests time out or assert wrong under the verification gate but pass locally — resource/contention flakes that redden main on otherwise-good merges. Flake-tolerance family (PAN-2373 lane).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2499",
      "rank": 47,
      "size": "XL",
      "importance": "medium",
      "score": 66,
      "condition": "ok",
      "dependsOn": [
        "PAN-2487",
        "PAN-2493"
      ],
      "why": "Unify the three issue views into one progressive-density IssueView (rail/cockpit/console) — operator-reviewed mockup, no-loss.",
      "rationale": "Three independently-built views (Console/Cockpit/Rail) drift; the spinner and ship row each had to be added twice. One data model + component family at three densities, with the mockup component inventory as a surface-lock no-loss gate. Operator-reviewed 2026-07-08; sizeable but not substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2493",
      "rank": 50,
      "size": "M",
      "importance": "medium",
      "score": 64,
      "condition": "ok",
      "dependsOn": [
        "PAN-2487"
      ],
      "why": "Align the cockpit Agents-lane and sidebar issue-tree feature sets (two-way gaps) — parity pass.",
      "rationale": "Gap A: cockpit lane lacks per-session lifecycle actions the sidebar has. Gap B: sidebar lacks the Verification node + gate breakdown the cockpit has. Extract shared row + verification components so future additions land in both.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2492",
      "rank": 52,
      "size": "M",
      "importance": "medium",
      "score": 62,
      "condition": "ok",
      "dependsOn": [
        "PAN-2486"
      ],
      "why": "Pane-detected waits (rate-limit/session-resume) surface as needs-you but cannot be answered from the dashboard — only the terminal.",
      "rationale": "rateLimit/sessionResume waits have no answerable dashboard component; click-through falls through to the AUQ-reopen path. Prefer resolving at source (PAN-2486) so they never reach needs-you; until then, render an inline answer widget that drives real keystrokes.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2489",
      "rank": 55,
      "size": "S",
      "importance": "medium",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Strike agents are invisible in the project issue tree — needs-you pings with no node to click.",
      "rationale": "Resource discovery matches agent-<issue>* under feature-<issue>; strikes use strike-<issue> in feature-<issue>-strike worktrees — neither matches. Include strike sessions as a Strike node with full Row affordances. Pipeline-side sibling: PAN-2270.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2491",
      "rank": 58,
      "size": "S",
      "importance": "medium",
      "score": 58,
      "condition": "ok",
      "dependsOn": [],
      "why": "Migrate @xenova/transformers to @huggingface/transformers — eliminates silent npx install failures from sharp 0.32 postinstall.",
      "rationale": "sharp<0.33 runs a network postinstall that fails silently under npx (EACCES on a stale libvips dir) — npx swallows it → exit 1, no error. Successor ships prebuilt binaries, no postinstall. Install-reliability fix for the npx @overdeck/core path.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2468",
      "rank": 70,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [],
      "why": "OKF knowledge skill v1 — Karpathy-loop wiki + okf-embeddings vector extension (/okf).",
      "rationale": "Portable Claude Code skill maintaining a project knowledge wiki in Open Knowledge Format; hybrid BM25+vector search. Standalone (git+gh+Python). In-pipeline (in-review). Feature, not substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2443",
      "rank": 72,
      "size": "L",
      "importance": "medium",
      "score": 56,
      "condition": "ok",
      "dependsOn": [
        "PAN-2388"
      ],
      "why": "OpenTelemetry GenAI semconv — OTLP ingestion layer for cross-harness telemetry (tokens/latency/tools).",
      "rationale": "gen_ai.* conventions standardize per-harness telemetry pain, but experimental + no cost/pricing in spec. Pin a snapshot + shim; token counts standardize, per-token rates remain ours. Cost-telemetry follow-on to PAN-2387/2388.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2442",
      "rank": 74,
      "size": "XL",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [
        "PAN-2416"
      ],
      "why": "Agent Client Protocol (ACP) as Overdeck structured control plane — replace tmux keystrokes, transcript parsers, prompt-detection with typ...",
      "rationale": "ACP standardizes the three things Overdeck reimplements per-harness (delivery, transcript, permission prompts). Large architectural play; research/PRD stage. Removes the per-harness scraping substrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2399",
      "rank": 76,
      "size": "S",
      "importance": "medium",
      "score": 53,
      "condition": "ok",
      "dependsOn": [],
      "why": "Wire replay_threshold/compaction_reroute into the slot-recovery respawn seam (PAN-2397 W3b).",
      "rationale": "tier-replay.ts is live library code whose production seam is slot-recovery: respawn prompts should carry rendered feed replay. Small, self-contained follow-on scoped out of PAN-2397 W3.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2424",
      "rank": 78,
      "size": "XL",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Epic: the Order Book — first-class operator priority queue (markdown-authored, backlog-exempt, load-governed, flywheel-integrated).",
      "rationale": "Formalizes the proven RUN-56/57/58 special-orders pattern: operator-authored priority queue that outranks the backlog, runs as fast as deps+load allow, exempt from auto-pickup. Operator-confirmed pillars. Container with no children filed yet; ranks by intended child impact.",
      "gate": "auto",
      "planning": "auto",
      "isEpic": true
    },
    {
      "issue": "PAN-2487",
      "rank": 150,
      "size": "M",
      "importance": "low",
      "score": 44,
      "condition": "ok",
      "dependsOn": [],
      "why": "CI-green merge skip + Ship & Merge cockpit view + active-node spinner — LANDED on main; only SSE/polyrepo/persist follow-ups remain.",
      "rationale": "Operator-requested, landed directly on main (2026-07-08). Work itself shipped; the open issue now tracks follow-ups (SSE vs polling, polyrepo ship-log coverage, persist last log). Ranked low — effectively done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2484",
      "rank": 160,
      "size": "S",
      "importance": "low",
      "score": 40,
      "condition": "ok",
      "dependsOn": [],
      "why": "fix(uat-train): ready set misses merge-eligible issues without flywheel merge verbs — eligibility sweep LANDED on main.",
      "rationale": "Landed on main (2026-07-08); sweepEligibleFeatures + flywheel emit-merge-verbs rule shipped. Open issue tracks only follow-up hardening (enrich swept features, unit test). Effectively done.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2444",
      "rank": 180,
      "size": "M",
      "importance": "low",
      "score": 38,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Optional SageOx re-integration — session-reasoning capture for OSS projects (per-project opt-in).",
      "rationale": "Research-stage: SageOx was removed in May; upstream has since shipped the equivalents and attribution concerns are superseded. Optional per-project opt-in, no clear pull yet. Needs refinement on whether/how to re-integrate.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2536",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 92,
      "condition": "ok",
      "dependsOn": [],
      "why": "stoppedByUser flag poisons every autonomous recovery path — deacon rebuilds the workspace stack forever (infinite Docker churn).",
      "rationale": "Live on PAN-2468 (2026-07-09): a review-failed work agent carrying stoppedByUser=true can never be autonomously recovered — every recovery path respects the flag, so the deacon spins on rebuild-and-start, reaps the idle stack after 15m, and rebuilds again, indefinitely. Data-wasting + liveness-killing substrate defect; unblocks the operator's manual recovery and the broader recovery net.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2538",
      "rank": 12,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan inspect mis-resolves bd bead-id vs vBRIEF item-id; a dead inspect session silently skips the gate — un-inspected beads pass.",
      "rationale": "Live on PAN-2468 (2026-07-09): pan inspect --bead <bd-bead-id> fails because the bd-assigned bead id is not the vBRIEF item id, and the fallback inspect session exited before emitting a verdict — the failure was swallowed as 'infrastructure failure', so the bead passed un-inspected. A silent inspection-gate skip lets uninspected work advance; critical substrate-integrity fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2519",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 91,
      "condition": "ok",
      "dependsOn": [],
      "why": "Wedged-but-alive work agents parked as troubled instead of killed+respawned — the recovery-net liveness gap underlying every wedge class.",
      "rationale": "The unifying recovery-net gap: the pipeline trusts 'session exists?' (PAN-2209 respawn only fires when the session is gone) and 'hooks say idle?' (stuck-remediation parks the agent as troubled). A wedged-but-alive agent (context-death, hung call, blocking dialog) defeats both and stalls invisibly to respawn. Fixing it (kill+respawn for rework-holding wedged agents, circuit-breaker guarded) closes the whole wedge cluster.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2524",
      "rank": 13,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "Review verdict signal hangs after emitting — review.approved never reconciles, so a passed review blocks merge indefinitely.",
      "rationale": "Live RUN-60 on PAN-2360: the review agent printed '✓ Review passed' then the signal CLI hung and had to be interrupted; review.approved never reconciled (not spontaneously, not on the stop-event), stranding a clean, mergeable PR. Every occurrence forces a redundant manual pan review request re-run. Critical merge-velocity defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2537",
      "rank": 14,
      "size": "M",
      "importance": "critical",
      "score": 90,
      "condition": "ok",
      "dependsOn": [],
      "why": "~90 issues look 'in pipeline' only because stale labels were never cleared; a reconciliation patrol restores true signal.",
      "rationale": "Of 107 issues carrying a pipeline label, only ~5 have a live agent; 52 carry a frozen verifying-on-main label (merged long ago, never closed-out) and 40 a stale planning label. Close-out is the durable label owner but these merged during incidents and bypassed it, so the dashboard/kanban drown the active handful. A label/read-model reconciliation patrol is the substrate fix for truthful pipeline signal — operator's primary visibility surface.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2534",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "Re-review request after rework doesn't dispatch while the prior review agent lingers idle — re-review stalls, merges stick.",
      "rationale": "Live RUN-60 on PAN-2270: pan review request after rework spawned no new review for ~6 minutes because dispatch keys off the prior review agent stopping, and it never stops on its own after writing its verdict. Re-review stalls until an operator force-kills the lingering agent. Critical in-pipeline velocity / stuck-merge defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2522",
      "rank": 15,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan start auto-plan finalizes spec+beads but never auto-spawns the work agent — every auto-planned issue stalls a full tick.",
      "rationale": "Live RUN-60 (twice): pan start's auto-plan completed cleanly (spec written, beads materialized, committed on main) but the promised 'work agent will start automatically after planning finalizes' never fired; the issue sat with no work agent for 7+ minutes until a manual second pan start spawned it from the ready spec. Every auto-planned start loses a full orchestration tick. Critical pipeline-velocity defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2520",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 88,
      "condition": "ok",
      "dependsOn": [],
      "why": "PAN-2209 dead-end respawn defers forever on stack-unhealthy; Deacon never auto-rebuilds the stack, so the issue never recovers.",
      "rationale": "Live on PAN-2468: PAN-2209's dead-end respawn returns 'stack-unhealthy' when the workspace Docker stack is down, and the deacon logs 'respawn deferred — stack-unhealthy' forever — nothing invokes the existing manual-only rebuild-and-start recovery. The issue is stuck in-review with zero automated path forward. Wiring the deacon to rebuild-and-start on this skip (circuit-breaker guarded) closes the dead-end.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2516",
      "rank": 16,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "Spec plan.status flips are left uncommitted in the shared primary worktree — spec-vs-record drift and blocks the flywheel push loop.",
      "rationale": "Live RUN-60 on the primary main worktree: pan close/pan start/merge-reconcile flip spec plan.status in the working tree but never commit/push it, so origin/main's spec mirror goes permanently stale for terminal issues (PAN-1124 invariant violation) and the uncommitted tree blocks the flywheel's own push. Critical substrate drift + flywheel-blocking defect.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2518",
      "rank": 17,
      "size": "M",
      "importance": "critical",
      "score": 87,
      "condition": "ok",
      "dependsOn": [],
      "why": "pan specialists done hangs forever when the completion-comment POST fails — no timeout/exit; issue stalls in-review with a live agent.",
      "rationale": "Live on PAN-2510: pan admin specialists done persists the verdict locally first (durable), then makes an advisory comment POST with no hard timeout and no guaranteed exit; when it stalls, the review/test agent that shelled out waits on it forever and the issue stalls in-review with a live-but-wedged agent. Bounding the advisory call (non-fatal, always exits) is the substrate fix. Recovery-net wedge-gap cluster sibling.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2511",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Work agents burn 20+ min on false test failures — sandbox denies spawnSync git (EPERM); local full-suite verify is redundant with the gate.",
      "rationale": "Live RUN-60 on PAN-2167: the work agent ran the full npm test as a self-check, hit spawnSync git EPERM (the sandbox blocks git subprocesses), misread it as a regression, and burned 21+ min waiting to re-run a step that can never pass in its sandbox — redundant with the PAN-174 verification gate that runs in the correct environment. A per-issue cycle-time sink on the metric the operator cares about (in-pipeline velocity).",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2502",
      "rank": 18,
      "size": "M",
      "importance": "critical",
      "score": 86,
      "condition": "ok",
      "dependsOn": [],
      "why": "Boot reconciliation dialog skipped on full reboot — an empty-candidate race terminally commits resume_all, ungating crashed-agent resume.",
      "rationale": "Live 2026-07-08 boot: on a full box reboot the dashboard stamps the boot-reconciliation snapshot before the deacon child reconciles liveness ~1s later, so the candidate list is empty; the PAN-2076 empty→resume_all fast path terminally commits, skipping the operator dialog AND leaving crashed agents to auto-resume ungated — the exact post-reboot safety problem the dialog exists to prevent. Critical boot-reliability/safety substrate fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2503",
      "rank": 35,
      "size": "M",
      "importance": "high",
      "score": 72,
      "condition": "ok",
      "dependsOn": [],
      "why": "Runtime agents table accumulates 700+ closed-issue rows forever — terminal detection is broken and nothing prunes; hot patrol paths bloat.",
      "rationale": "listAllAgentsSync returns 729 rows (only 3 running); closed-issue rows are disposable (their durable state lives in .pan/records) but terminal detection returns 0 terminal issues, so nothing prunes them and the boot-reconciliation + auto-resume hot paths carry dead weight. High substrate-hygiene/perf fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2526",
      "rank": 40,
      "size": "L",
      "importance": "high",
      "score": 70,
      "condition": "ok",
      "dependsOn": [],
      "why": "deacon.ts is a 3615-line god file above its baseline; shrink it so the file-size ratchet can move down again (red-main trap).",
      "rationale": "Follow-up to PAN-2525: main was unblocked by rebaselining deacon.ts to 3615 lines, but it remains a god file. Shrinking it below baseline lets the file-size ratchet move down again — the same baseline mechanism that gates red-main. High substrate debt.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2505",
      "rank": 40,
      "size": "M",
      "importance": "high",
      "score": 68,
      "condition": "ok",
      "dependsOn": [],
      "why": "lint:circular is red on main — new frontend cycles + stale baseline; the lint quality gate fails independent of any feature work.",
      "rationale": "npm run lint → lint:circular fails on main with new circular deps in chat/conversations components plus stale baseline entries. It is a quality gate, so every PR/CI run and every local lint hits a red that isn't theirs. High (red gate); fix is to break the cycles, not rebaseline.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2521",
      "rank": 45,
      "size": "S",
      "importance": "high",
      "score": 64,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline agents wedge on the harness 'switch to gpt-5.4-mini?' rate-limit dialog; disable that reminder at launch so the pane never freezes.",
      "rationale": "Codex/Claude surface an interactive rate-limit model-switch dialog inside the agent TUI that blocks the pane (no tool calls fire, session wedges; observed on PAN-2359's review). Disabling the reminder at the launcher layer removes the cause for this wedge class — defense-in-depth alongside the kill+respawn recovery fix.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2507",
      "rank": 50,
      "size": "L",
      "importance": "high",
      "score": 60,
      "condition": "ok",
      "dependsOn": [],
      "why": "Preemptive scheduler: yield idle work agents to free capacity for blocked review/test/merge dispatch — a pipeline-throughput multiplier.",
      "rationale": "PRD-backed feature: when an advancing (review/test/merge) dispatch can't reserve capacity, the deacon defers forever; a preemptive scheduler yields an idle work agent (pause, resumable) to free the slot, then auto-resumes oldest-first. Opt-in, complements the critical PAN-2500 memory governor. High-impact throughput feature (not a bug), so ranks below the live substrate defects.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2535",
      "rank": 60,
      "size": "S",
      "importance": "medium",
      "score": 55,
      "condition": "ok",
      "dependsOn": [],
      "why": "POST /api/agents returns an opaque 500 (not the designed 422) when `bd list` exits non-zero — an inert try/catch around a failing Effect.",
      "rationale": "Scoped to the work-agent start path: a JS try/catch around a failing Effect yield is inert, so a bd-list non-zero exit escapes as an unhandled 500 instead of the designed 422. Medium — correct error semantics on one route, no live-agent impact.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2533",
      "rank": 70,
      "size": "M",
      "importance": "medium",
      "score": 52,
      "condition": "ok",
      "dependsOn": [],
      "why": "UAT workspace magic-link login 502s — Traefik picks an unreachable multi-homed IP (regression from PAN-2428); blocks UAT verification.",
      "rationale": "Regression from PAN-2428: a multi-homed Traefik-routed container with no traefik.docker.network label gets an arbitrary backend IP; when it draws the panopticon IP, the gateway 502/504s. Blocks MYN UAT login (verification flow), non-deterministic per workspace. Medium, UAT-scoped.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2528",
      "rank": 80,
      "size": "M",
      "importance": "medium",
      "score": 50,
      "condition": "ok",
      "dependsOn": [],
      "why": "Harness picker offers ohmypi for Anthropic+subscription combos it rejects at spawn (ToS) — prevent the invalid choice up front.",
      "rationale": "The ToS gate (Anthropic model under Claude Code subscription auth via ohmypi) is enforced only at spawn; the picker still offers the blocked combination with inconsistent UX. Medium — move the ToS gate earlier and explain it; no runtime correctness change.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2527",
      "rank": 100,
      "size": "M",
      "importance": "medium",
      "score": 45,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Harness selector should offer only the ToS-correct native harness per model; today invalid choices are selectable then fail at runtime.",
      "rationale": "Needs refinement: the title says 'restrict OpenAI models to Claude Code only', but actual correct routing is GPT→Codex / Kimi→OMP / Anthropic→Claude Code (per harness-policy.ts), so the title's prescription contradicts the system's intended routing. Intent (offer only the ToS-correct native harness, fail upfront) is sound; scope/title must be reconciled before work.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2514",
      "rank": 120,
      "size": "XL",
      "importance": "medium",
      "score": 42,
      "condition": "needs-refinement",
      "dependsOn": [],
      "why": "Dashboard Observability page intercepts model API traffic as collapsible blocks — see exactly what eats each request's context.",
      "rationale": "Concept issue with a draft PRD and mockup: a new dashboard page passively capturing the model API traffic Overdeck already proxies, rendered as collapsible context blocks (system prompt, tool schemas, history, usage). Useful observability, but a concept awaiting scope/UX sign-off — not substrate and not blocking; needs-refinement until the approach is approved.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2504",
      "rank": 300,
      "size": "M",
      "importance": "low",
      "score": 30,
      "condition": "ok",
      "dependsOn": [],
      "why": "npx @overdeck/core fails on old Node after a slow install; auto-relaunch under a detected Node 22+ to remove first-run friction.",
      "rationale": "DX improvement: probe common Node-22+ install locations and re-exec under them when the shell default is old, instead of failing late in serve. Low — first-run friction only; most users already have a compatible Node somewhere.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2501",
      "rank": 350,
      "size": "S",
      "importance": "low",
      "score": 28,
      "condition": "ok",
      "dependsOn": [],
      "why": "deleteResourceVenvEffect's HttpRouter.schemaParams call fails root-tsconfig typecheck (masked by src/dashboard exclusion) — latent.",
      "rationale": "Latent typecheck bug: a single-generic schemaParams call fails under the root tsconfig (which resolves effect differently) but is masked because root excludes src/dashboard/**. Low — not currently breaking anything; surfaced only when a src/lib module imports from that file.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2506",
      "rank": 400,
      "size": "XS",
      "importance": "low",
      "score": 25,
      "condition": "ok",
      "dependsOn": [],
      "why": "flywheel-primary-root.test.ts fails on macOS — /var vs /private/var symlink not canonicalized; CI (Linux) is green.",
      "rationale": "Dev-only portability bug: macOS tmpdir (/var → /private/var symlink) breaks 3 of 4 assertions; CI on Linux is green. Low — affects only macOS local runs; fix is canonicalizing the expected path in the test.",
      "gate": "auto",
      "planning": "auto"
    },
    {
      "issue": "PAN-2532",
      "rank": 450,
      "size": "S",
      "importance": "low",
      "score": 22,
      "condition": "ok",
      "dependsOn": [],
      "why": "Pipeline rows truncate the title early while horizontal space sits empty — reclaim width for the title without adding height.",
      "rationale": "Cosmetic dashboard tweak: collapse the fixed 200px status column into a title-first 4-column layout so the issue title gets ~440px instead of ~120px, at no extra height. Low — UI polish, no functional impact.",
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
      "from": "PAN-2228",
      "to": "PAN-2255",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.72
    },
    {
      "from": "PAN-2252",
      "to": "PAN-2280",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2280",
      "to": "PAN-2282",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2282",
      "to": "PAN-2280",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2285",
      "to": "PAN-2228",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2292",
      "to": "PAN-2308",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2331",
      "to": "PAN-2333",
      "type": "informs",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2347",
      "to": "PAN-2348",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2323",
      "to": "PAN-2307",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2293",
      "to": "PAN-2307",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-2322",
      "to": "PAN-2292",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-2228",
      "to": "PAN-2179",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
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
      "from": "PAN-2350",
      "to": "PAN-658",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2372",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2364",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2376",
      "to": "PAN-2229",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-1166",
      "to": "PAN-2351",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2352",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2353",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2354",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2352",
      "to": "PAN-2355",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2351",
      "to": "PAN-2356",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2356",
      "to": "PAN-658",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2379",
      "to": "PAN-2372",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.7
    },
    {
      "from": "PAN-1666",
      "to": "PAN-2500",
      "type": "contains",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2486",
      "to": "PAN-2492",
      "type": "unblocks",
      "source": "github-ref",
      "confidence": 1
    },
    {
      "from": "PAN-2487",
      "to": "PAN-2499",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2493",
      "to": "PAN-2499",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2487",
      "to": "PAN-2493",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2495",
      "to": "PAN-2487",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-2485",
      "to": "PAN-2469",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.85
    },
    {
      "from": "PAN-2498",
      "to": "PAN-2469",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2469",
      "to": "PAN-2467",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2417",
      "to": "PAN-2473",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.9
    },
    {
      "from": "PAN-2473",
      "to": "PAN-2406",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2408",
      "to": "PAN-2409",
      "type": "unblocks",
      "source": "ai-inferred",
      "confidence": 0.75
    },
    {
      "from": "PAN-2409",
      "to": "PAN-2414",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.55
    },
    {
      "from": "PAN-2466",
      "to": "PAN-2443",
      "type": "informs",
      "source": "ai-inferred",
      "confidence": 0.6
    },
    {
      "from": "PAN-2465",
      "to": "PAN-2461",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2416",
      "to": "PAN-2442",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.55
    },
    {
      "from": "PAN-2538",
      "to": "PAN-2468",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2536",
      "to": "PAN-2468",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2536",
      "to": "PAN-2520",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2520",
      "to": "PAN-2468",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2519",
      "to": "PAN-2520",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.75
    },
    {
      "from": "PAN-2518",
      "to": "PAN-2519",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2507",
      "to": "PAN-2500",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.8
    },
    {
      "from": "PAN-2501",
      "to": "PAN-2500",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    },
    {
      "from": "PAN-2521",
      "to": "PAN-2486",
      "type": "informs",
      "source": "github-ref",
      "confidence": 0.7
    }
  ]
}
```
