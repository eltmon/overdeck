# Overdeck: Complete Update Since March 26th deft.co Meeting
*Exhaustive thematic brief — for marketing distribution, investor materials, and partner updates*

---

## Executive Summary

Since meeting with the deft.co team on March 26, 2026, Overdeck has shipped **765+ commits**, resolved **60+ tracked issues**, and undergone its most significant architectural evolution to date. The system is now a production-grade, multi-agent orchestration platform that has been **continuously dogfooded on itself** — every commit listed below was written by Overdeck agents working through the Overdeck pipeline.

The headline story is **end-to-end automation**: an issue now flows from human intent → vBRIEF plan → beads tasks → work agent → parallel code review convoy → test specialist → merge specialist → GitHub PR → squash-merged main, with the human only clicking "merge" as the final gate. The pipeline is hardened, observable, and resumable from any failure mode.

This document is organized into themes, each suitable for individual marketing pieces, blog posts, demo videos, or investor updates.

---

## Theme 1: vBRIEF — Deep Integration of deft.co's Planning Standard

**The headline for deft.co specifically.** Overdeck is one of the first real-world production implementations of vBRIEF as the connective tissue of an entire AI development workflow.

### What we built
- **Full vBRIEF lifecycle support**: planning agents generate `plan.vbrief.json` files containing DAG dependencies, difficulty metadata, acceptance criteria, and per-task kind labels
- **Workspace integration**: vBRIEF plans live in `.planning/` directories during active work and auto-archive to `docs/prds/active/` on merge
- **Schema extension**: extended vBRIEF with our own metadata fields (`difficulty`, `issueLabel`, `kind`) using the spec's official extension mechanism
- **Upstream contribution**: proposed our extension fields back to **deftai/vBRIEF#1** as first-class citizens
- **Maintained fork**: kept a Overdeck fork in case the schema needs to evolve independently while we wait for upstream
- **Agent-driven beads materialization**: `pan plan-finalize` lets the planning agent itself convert vBRIEF tasks into beads work items with dependency tracking — no manual transcription
- **Full viewer suite**: every Kanban card has a vBRIEF button that opens list view, DAG visualization, and raw JSON tabs
- **Inspector Panel integration**: vBRIEF context is rendered phase-by-phase as work progresses through the pipeline
- **Kanban planning chips**: each card shows live vBRIEF (green when ready) and Tasks (red "Generate Tasks" when plan exists but beads aren't materialized) chips, finishable in one click
- **Inline finalization**: PlanDialog has a Generate Tasks warning callout so users complete the planning handoff without leaving the dialog
- **Centralized PRD location resolution**, normalized to lowercase for portability

### Why deft.co should care
vBRIEF was created to solve the fragmentation of AI agent memory and planning formats. Overdeck proves vBRIEF can be the *spine* of a multi-agent development workflow — not just a planning artifact, but the live coordination format between planning, work, review, test, and merge agents. Every issue, every task, every acceptance criterion in Overdeck flows through vBRIEF end-to-end.

---

## Theme 2: PR-Based Workflow & GitHub App Integration

The biggest architectural shift since March. Overdeck used to merge locally in the main repo, bypassing GitHub. It now has a full, audited GitHub PR lifecycle.

### What we built
- **GitHub App** (`panopticon-agent[bot]`) installable from the GitHub Marketplace
- **Bot identity**: all commits and PRs show the Overdeck bot, never a personal account
- **Branch protection**: `main` is now protected with rules enforced via the App
- **Automatic JWT + installation token refresh** — no manual token rotation
- **Commit status reporting**: CI checks reported back to GitHub as commit statuses
- **PR creation on `pan work done`** with rich body: issue link, beads summary, and acceptance criteria checklist
- **Review agent posts GitHub PR reviews** (`gh pr review --approve` / `--request-changes`) — permanent audit trail outside Overdeck
- **Squash merge** via `gh pr merge --squash` — one commit per feature in main history
- **GitHub App used for protected branch merges** — the bot punches through branch protection where personal PATs would fail
- **Squash-merge detection** in close-out and auto-focus draft composer
- **CI pipeline upgraded**: removed `|| true` passthroughs, added real `npm test`, made typecheck a required check

### Marketing angle
Every line of agent-produced code now goes through the same PR review process a human team uses — and the audit trail lives in GitHub, where engineering leadership already looks. There is no "trust me, the agent did it." There is a PR, a review, a test result, a status check, and a squash merge.

---

## Theme 3: The Merge System — Production-Grade Reliability (PAN-632)

A ground-up rewrite of the merge pipeline that turned the riskiest part of agent-driven workflows into the most reliable.

### What we built
- **In-process rebase + SQLite-backed merge queue** — eliminates concurrent rebase thrashing
- **Serialized merge queue** — `mergeQ.current` is set immediately to prevent race conditions; `try/finally` guarantees the next merge dequeues on every exit path
- **Post-rebase verification gate (PAN-625)** — every merge runs verification *after* rebase but *before* the actual merge, catching code that broke during conflict resolution
- **Work agent rebases on merge click**, not in-process during the work phase — cleaner separation of concerns
- **`merge-set` workflow (PAN-632)** — multi-issue merge sets are now first-class
- **`GET /api/merge-queue`** endpoint for full queue visibility
- **Frontend `verifying` mergeStatus** — UI reflects every queue state
- **Merge action directly on Kanban cards** — one click from "ready" to "merged"
- **Post-merge lifecycle runs after dequeue** — prevents process kills during deploy from corrupting the queue
- **Deacon patrol** processes pending post-merge lifecycle (PAN-626)
- **GitHub PR comment posted on merge failure** with broken-resume fallback removed
- **Hardened against**: stale `readyForMerge` after verification failures, queued/verifying statuses lost on startup, in-memory queue lost on restart, multi-merge race conditions, post-merge process death (PAN-626, PAN-627, PAN-628, PAN-615)

### Marketing angle
Merging is where AI agent workflows usually fall apart. Overdeck's merge system is now bank-grade: serialized, verified, queued, observable, and resumable from any failure point.

---

## Theme 4: Multi-Provider Architecture — Provider-Agnostic by Design

Overdeck now routes across all major model providers with a unified, configurable abstraction.

### What we built
| Provider | Models | Status |
|---|---|---|
| **Anthropic** | Claude Opus 4.6, Sonnet 4.6, Haiku 4.5 | Default |
| **MiniMax** | M2.7, M2.7-highspeed | Live |
| **OpenRouter** | Full catalog with favorites | Live |
| **Z.AI** | GLM 5.1, GLM 4.7 | Live |
| **Claudish** | Subscription-aware routing | Live |

- **Eliminated `claude-code-router` dependency entirely** — all providers now use direct env-var injection (`ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `MINIMAX_API_KEY`, etc.) via `config.yaml`
- **Unified model selection** via `claude --model <name>` for all providers
- **Claudish subscription-aware routing** — routes correctly through Claude subscription accounts
- **Settings UI** with model picker, provider toggles, lucide icons per provider, favorites support
- **Auto-select usable models** based on which credentials are present
- **Adaptive ModelPicker dropdown** that avoids viewport clipping
- **Provider-disabled state** respected throughout routing
- **Switch model before sending message** in active conversations
- **Stop draining tokens on idle agents** — significant cost savings
- **Removed stale localStorage model defaults** that overrode user picks
- **Always show all models in dropdown** regardless of API key config (lets users see what's available)
- **Model registry updated to April 2026** with live model catalog

### Marketing angle
Overdeck is **not Anthropic-exclusive**. Customers run agents on the model that fits their cost, latency, and quality envelope — including subscription-routed Claude, GLM, MiniMax, OpenRouter's full catalog, and any model-per-agent-type configuration through Cloister.

---

## Theme 5: Cloister — The Agent Lifecycle Brain

Cloister is Overdeck's watchdog and lifecycle manager. It got major reliability work since March 26th.

### What we built
- **Container restart backoff** — exponential backoff on crash/restart/give-up prevents hot-loop spinning
- **Orphaned process cleanup** — detects and reaps zombie tmux sessions and stale containers
- **Crash alerting via tmux** — when a container crashes, the agent inside its session sees the alert immediately
- **Startup recovery** — orphaned `reviewStatus=reviewing` issues are recovered on boot
- **Busyness queueing** — when a specialist is busy, work queues instead of `dispatch_failed`. No lost work.
- **Specialist pipeline edge cases handled**:
  - Test agent is stateless and never resumes
  - Merge agent does **all** merges (not just conflicts)
  - Review invalidates when an agent commits after review passes (no stale approvals)
- **Deacon health monitoring** — full subsystem with documented health checks
- **Deacon detects dead planning sessions** with `remain-on-exit` tmux
- **`pan work done` auto-resets blocked/failed review status** before re-dispatch
- **Auto-deliver feedback to work agent** on review block or test failure
- **Recover dispatch through specialist queue** — not out-of-band
- **Idle project specialists marked completed** — stops them from being treated as stuck
- **Stale in-review state reconciled** on startup
- **Stuck pipeline states marked recoverable** in the dashboard
- **Recover action surfaced in dashboard**, cycle limits aligned
- **Agent taxonomy added to planning prompt** (PAN-605) — fixes planning agents that confused Claude Code subagents (`codebase-explorer`, `plan`) with Overdeck specialists (`review-agent`, `test-agent`, `merge-agent`)

### Marketing angle
Cloister means agents that don't get stuck. The recovery loop, the queue, the busyness gating, and the deacon make Overdeck resilient to the failure modes that destroy hand-rolled agent setups.

---

## Theme 6: Specialist Pipeline — Review → Test → Merge

The end-to-end automation that means humans only click merge.

### What we built
- **Parallel review convoy** with three reviewers running in parallel: **correctness**, **security**, and **requirements** (PAN-451)
- **Convoy synthesis** produces a single unified review result
- **Review posted as GitHub PR review** in addition to feedback files
- **Review agent must BLOCK on ANY finding** — no more "pass with notes" letting issues slip
- **Review invalidated when agent commits after review passes** — prevents stale approvals
- **Specialists never resume sessions (PAN-612)** — resuming corrupted Claude's "thinking" signatures; specialists now always start fresh
- **Random UUIDs for ephemeral specialist sessions** — deterministic IDs collided with `--session-id`
- **Stopped specialists have a conversation view** in the dashboard (PAN-510) — read the transcript after the fact
- **`request-review` dispatches test when `testStatus` is `pending`**, not just `failed`
- **Test agent runs `npm test`, typecheck, lint** as a real CI gate
- **Merge agent uses GitHub App** for protected merges
- **Three-specialist handoff fully automated** — review passes → test runs → test passes → merge becomes ready

### Marketing angle
This is the demo. Issue → plan → work → review → test → merge → green main. The human's job is to click MERGE.

---

## Theme 7: Desktop App — Electron + npm Distribution

Overdeck ships as a **one-command-installable desktop app**.

### What we built
- **Published as `panopticon` npm package**
- **`npx panopticon serve`** — server + browser only
- **`npx panopticon`** — full Electron desktop app
- **System tray** with agent status color (green / yellow / red), right-click menu
- **Native notifications**, each toggleable independently:
  - Input Needed
  - Stuck Agents
  - Merge Failures
  - Work Complete
  - Merge Ready
- **Auto-start on login** with gentle nag flow
- **Cmd+K / Ctrl+K command palette** — jump to any running agent or view
- **Menu bar (macOS)** with Cloister start/stop, Emergency Stop, workspace list
- **IPC bridge** (`window.panopticonBridge`) for desktop-specific features
- **Custom `panopticon://` protocol** for packaged builds
- **Pure Node 22** runtime — no Bun assumption at runtime

### Marketing angle
Overdeck is not a CLI you have to babysit in a terminal. It's a desktop app with a system tray, native notifications, and one-command install via npx.

---

## Theme 8: Real-Time Live Terminal — XTerminal

The Agents page now shows live, attached terminals — not log scrapes.

### What we built
- **Raw `node-pty` + WebSocket terminal at `/ws/terminal`** — tmux session streams live to the browser
- **Reconnection with exponential backoff**, session-ended state detection
- **Connection quality feedback** in the UI
- **Full-size mode toggle**
- **Detachable workspace terminal** — pop-out terminal panel
- **Native xterm.js scrollback** restored (5000 lines)
- **Wheel scroll handler** + reconnect-clear logic
- **Per-client blackout** to prevent scrollback flood on reconnect
- **Tmux `refresh-client` after PTY spawn** to clear stale cursor artifacts
- **Multi-client resize conflict prevention** + initial-fit fix
- **Disabled cursor blink** (was leaving dot artifacts in empty rows)
- **Forced xterm.js repaint** after scrollback dump
- **Staggered terminal refresh** to clear dots from variable-length scrollback
- **`fit()` instead of `refresh()`** for clearing stale artifacts
- **Replaced SIGWINCH dimension toggle** with `refresh-client` in hub-join path
- **Deterministic snapshot protocol** replaces terminal attach heuristics
- **Reset `hadFirstData` on WebSocket reconnect** so refresh fires every connection
- **Reset terminal panel when switching agents**
- **Stale-session-path migration** in DB
- **Keystroke echo accumulation fix** on reconnect

### Marketing angle
Live agent terminals — exactly what the agent sees, in your browser, at full fidelity. No log tailing.

---

## Theme 9: Inspector Panel — Phase-Aware Mission Control

The Mission Control agent detail pane is now **contextual**.

### What we built
- **Phase tab strip** — active pipeline phase is detected and the panel shows contextually relevant information
- **Transcript / Terminal view toggle** — switch between conversation transcript and live terminal
- **Manual pin** — lock the panel to a specific agent regardless of what's happening elsewhere
- **Pipeline phase indicator** in header
- **Prose notes CSS** for markdown rendering in review notes
- **Conversation view for stopped specialists** (PAN-510)
- **Specialist JSONL conversation view** added to the Agents page

### Marketing angle
You don't switch tabs to debug an agent. The Inspector follows the work.

---

## Theme 10: Effect.js Migration — Type-Safe Server Internals (PAN-470)

A massive internal quality improvement that's invisible to users but eliminates entire classes of bugs.

### What we built
- **Entire dashboard server migrated** from mixed try/catch + `runSync` + sync I/O to idiomatic Effect.js
- **All route handlers** use Effect's typed error channels
- **No more `execSync`** in dashboard server code (PAN-70 fixed across 15+ commits)
- **`runSync` eliminated** everywhere in server-reachable modules
- **Event store, read model, cache service, all services** use Effect's layer system
- **Fixed `Effect.yield*` failures** that weren't caught by JS try/catch
- **`sendKeysAsync()` not `sendKeys()`** in all server-reachable modules

### Marketing angle
Type-safe error channels mean bugs become compile errors. The dashboard server now enforces async-everywhere and typed-errors-everywhere via the type system.

---

## Theme 11: Conversation System — Deterministic Sessions

### What we built
- **Deterministic session IDs** via UUID v5 from project + issue + timestamp — fully reproducible, no random IDs
- **Resume with message input popup** — click Resume, type a message, agent responds in context
- **Session recovery post-restart** for In Review cards
- **Snapshot-before-spawn session discovery** — finds only genuinely new files
- **Specialist JSONL conversation view** on the Agents page
- **Non-blocking spawn + live polling** for conversation creation
- **Compact-on-switch** + sync model picker
- **Double `conv-` prefix fix** in tmux session names
- **Stale localStorage model default** removed
- **Stop-agent button** in conversation list

---

## Theme 12: Session Compaction (PAN-542)

When Claude compacts its context window, Overdeck now rotates specialist JSONL sessions instead of losing them.

### What we built
- **`session_compact_offsets` SQLite table** tracks which compact boundary each session is reading from
- **JSONL truncation on compaction** — old history preserved but trimmed to a boundary
- **`reset-session` API endpoint** for manual rotation
- **Session generation deterministic and auditable**

### Marketing angle
Long-running specialist agents (merge, review) can run for weeks without losing context.

---

## Theme 13: Kanban / Card UX Redesign

### What we built
- **Compact icon-only action buttons** (#584) — denser, more glanceable
- **Merge action directly on Kanban cards**
- **Cards redesigned** with hardened cancel flow
- **Destructive cancel-issue flow**
- **Live board state refreshes after actions** — no stale cards
- **Stop showing "done" for in-review work**
- **Done column visible by default** without "Include closed" checkbox
- **vBRIEF chip** (green when plan exists) and **Tasks chip** (red "Generate Tasks") on every card
- **"See Plan"** rename when plan exists
- **"Plan" label** added back to workspace card branch indicator
- **Auto-scroll during streaming** with scroll-to-bottom button
- **Sticky settings action bar**
- **Kanban filter bar** two-row layout
- **Optimal Defaults** confirmation dialog
- **Click-to-confirm removed from Start Agent** — fires immediately
- **In-progress branch** no longer renders Resume Session unconditionally
- **Recover action surfaced**, ready badge aligned with merge readiness
- **Merge action shown on active review cards**
- **Merged-card state reconciled**

---

## Theme 14: Command Deck Improvements

### What we built
- **Sidebar model picker for new conversations** (#581)
- **Stop-agent button** in conversation list
- **Conversation selection no longer jumps or flickers**
- **Header title clipping fixed** at narrow widths
- **Hidden new-conv button surfaced**
- **Project features display** in Command Deck
- **Slash command menu** populated with all `pan` CLI commands
- **Slash menu in composer** scoped to workspace, not global search
- **Dark mode** + draft text preservation across navigation

---

## Theme 15: Beads Auto-Init & Recovery (PAN-507, PAN-506, PAN-639)

Beads is the git-backed task tracker that backs the agent's working memory.

### What we built
- **Three-layer recovery**: workspace spawn → beads check → auto-init if missing
- **Beads role validated and fixed** (was using invalid `'agent'`, now `'contributor'`)
- **`bd init -l`** shorthand now works
- **`beads.role` config** properly set on init
- **Beads git tracking restored** + deleted data recovered (PAN-639)

---

## Theme 16: Project Artifact Migration — `.pan/` (PAN-488)

### What we built
- **`~/.panopticon/` → `~/.pan/`**
- **`.panopticon.yaml` → `.pan.yaml`** with backwards-compat fallback
- **Safe migration script** for existing installations
- **Multi-tool skill sync** targets `.pan/skills/` for Claude Code, Cursor, Codex, and more

---

## Theme 17: Memory Monitoring (PAN-513)

### What we built
- **Dashboard shows available RAM**
- **Guard rails before spawning agents** — checks memory before launching new agent containers
- **Prevents OOM** in development

---

## Theme 18: Auth & Credentials

### What we built
- **macOS Keychain credential detection** (PAN-593) — no manual re-auth on Mac
- **Auto-refresh** for `claude-auth`
- **Tests added** for credential detection paths

---

## Theme 19: CLI / Setup Quality

### What we built
- **`pan up` auto-syncs skills on startup**
- **Enforces Playwright `--isolated`** on sync
- **Quickstart docs updated** for auto-sync
- **Board stats bar** redesigned

---

## Theme 20: Architecture — Event Store + Read Model + SQLite

### What we built
- **Event store** (`event-store.ts`) using `bun:sqlite` with named/positional param compatibility
- **Read model bootstrapped from event stream**, updated via domain event subscriptions
- **Projection cache** uses positional SQL params (`bun:sqlite` compatibility)
- **Server-side read model** (PAN-433) for clean RPC data separation

---

## Theme 21: Documentation & Roadmap PRDs

### What we built
- **Master doc index** (`docs/INDEX.md`)
- **PRDs added** for **progressive polyrepo**, **flexible tracker IDs**, and **setup wizard**
- **`DEACON-HEALTH-MONITORING.md`** added to docs index
- **`CLAUDE.md` population audit diagram** (PAN-605)
- **PAN-632 PRD locked** with end-to-end pipeline design
- **Quickstart and docs updated** for auto-sync on `pan up`
- **Marketing demo videos** tracked
- **Refactored docs cross-references**

---

## Theme 22: Demo-Worthy Workflow Polish

These are the small fixes that compound into "this just works."

### What we built
- **Auto-deliver feedback to work agent** on review block or test failure
- **`pan work done` auto-resets blocked/failed status**
- **Detect squash merges** in close-out and auto-focus draft composer
- **GitHub PR comment** posted on merge failure
- **Stuck pipeline states** marked recoverable
- **Cycle limits aligned** with merge readiness
- **Done column visible** by default
- **All terminal artifact bugs** systematically eliminated
- **Beads auto-init** so new workspaces never silently fail
- **Conversation selection** no longer flickers
- **Idle agents stop draining tokens**
- **Provider disabled state** respected in model routing

---

## Theme 23: Fork & Open Standards Strategy

### What we built
- **vBRIEF fork maintained** alongside upstream
- **vBRIEF extensions proposed upstream** at deftai/vBRIEF#1
- **Beads** used as the open, git-backed task tracker
- **GitHub PRs** as the audit trail (no proprietary lock-in)
- **Multi-provider** model abstraction (no vendor lock-in)
- **Multi-tool skill sync** (Claude Code, Cursor, Codex)

### Marketing angle
Overdeck is built on open standards: vBRIEF for plans, beads for tasks, GitHub for review and merge, and a multi-provider abstraction so customers are never locked into one model vendor. We *contribute* to vBRIEF rather than fork-and-forget.

---

## Theme 24: Production Dogfooding at Scale

The single most credible thing we can say.

### The story
- **765+ commits** since March 26th
- **60+ tracked issues** resolved
- **Every feature listed above** went through the vBRIEF planning → work agent → beads → review → merge pipeline
- The bot user `panopticon-agent[bot]` is the author of nearly all commits
- The **same dashboard the customer sees** is the dashboard we use 12+ hours a day
- **MYN, Auricle, OpenClaw, Krux** are also being developed via Overdeck (multi-project orchestration in production)
- **deft.co's vBRIEF** powers it end-to-end

### Marketing angle
Overdeck doesn't have a "demo mode." The thing in the demo is the thing we build it with. Every commit is proof of work.

---

## Suggested Marketing Angles for Distribution

### For investor decks / deft.co follow-up
- **Theme 1 (vBRIEF)** + **Theme 23 (Open Standards)** + **Theme 24 (Dogfooding)**

### For technical blog posts
- **Theme 3 (Merge System)** — "How we built a bank-grade merge pipeline for AI agents"
- **Theme 10 (Effect.js)** — "Why we migrated 100% of our server to Effect"
- **Theme 5 (Cloister)** — "Building agents that don't get stuck"
- **Theme 6 (Specialists)** — "Review → Test → Merge: end-to-end automation"

### For demo videos
- **Theme 6 (Specialists)** — the headline demo
- **Theme 13 (Kanban UX)** — the visual story
- **Theme 8 (Live Terminal)** — the "wow this is real" moment
- **Theme 1 (vBRIEF)** — the deft.co partnership story

### For social / Twitter / LinkedIn
- **Theme 7 (Desktop App)** — "`npx panopticon` and you're running"
- **Theme 4 (Multi-Provider)** — "Pick any model. Run any agent."
- **Theme 24 (Dogfooding)** — commit count + bot author screenshots

### For partnership / sales conversations
- **Theme 2 (PR Workflow)** + **Theme 6 (Specialists)** — "Audit trail every engineering leader will accept"
- **Theme 23 (Open Standards)** — "No lock-in, ever"

### For hiring / community
- **Theme 10 (Effect.js)** + **Theme 20 (Architecture)** — "Type-safe, event-sourced, batteries-included"

---

## One-Sentence Pitches (for adaptation)

- **The deft.co line**: "Overdeck is the first production multi-agent orchestrator built on vBRIEF — every issue, plan, task, and merge flows through deft.co's open planning standard."
- **The technical line**: "Overdeck turns a GitHub issue into a squash-merged PR through a hardened review → test → merge specialist pipeline, with humans only clicking 'merge.'"
- **The dogfooding line**: "765 commits in 17 days, written by Overdeck agents using Overdeck to build Overdeck."
- **The desktop line**: "`npx panopticon`. System tray, native notifications, multi-provider, multi-project. One command."
- **The investor line**: "We dogfood our own product 12 hours a day across four projects. Every commit is proof of work."

---

*This document is exhaustive by design. Pull from it freely — each theme is self-contained and can become a tweet, a paragraph, a blog post, a slide, or a demo script.*
