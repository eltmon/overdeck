# Universal Context System — PR-FAQ

**Epic:** PAN-1200
**Status:** In flight (planning, all four children)
**Drafted:** 2026-05-24
**Target launch:** 2026-06-21 (~ four weeks)

---

## Press Release

**FOR IMMEDIATE RELEASE**

### Panopticon Launches Universal Context System: Every Agent, Every Harness, Always Briefed

*No more cold starts. Live session briefings, on-demand documentation retrieval, layered configuration distribution, and shareable HTML artifacts ship together in Panopticon 0.6.*

**SEATTLE — June 21, 2026 —** Today Panopticon ships the **Universal Context System** — four connected capabilities that end the cold-start problem for AI coding agents. Whether a developer is using Claude Code, Pi, or any future harness, every agent now arrives briefed on what's happening across the system, with on-demand access to Panopticon's own documentation, and the ability to publish its work as inspectable HTML artifacts shareable with humans and other agents.

"We were rewriting the same context briefing every session," said **Edward Becker, creator of Panopticon**. "Now the orchestrator owns the briefing. Every agent that lands in a workspace already knows what the last session did, what its siblings are doing, and how to use the project's own conventions. The Home tab is the dashboard's new front door — one glance and you see everything in motion."

The Universal Context System has four parts that ship together:

**1. Hybrid Context Distribution.** A layered model (global / project / workspace) replaces the legacy `sync.devroot` convention. Single canonical markdown sources render to harness-specific files via `{{#harness:claude}}` / `{{#harness:pi}}` templating. Projects can now live anywhere on disk — register them with `pan projects add <path>` instead of being forced under `~/Projects/`.

**2. Panopticon Documentation RAG.** Every install ships a prebuilt FTS5 + embedding index of Panopticon's own docs. When an agent's prompt mentions concepts like *"pan sync"*, *"workspace"*, or *"cloister"*, a UserPromptSubmit hook injects the top-k most relevant doc snippets — no first-run indexing cost, no model dependency at install, no token blowout (per-conversation cap, per-injection cap, telemetry for tuning).

**3. Home Tab + Live Session Briefing.** The dashboard's new landing route surfaces running agents, paused gates, recent merges, failed verifications, and a time-bucketed activity feed across every workspace. The same content writes to `~/.panopticon/session-context.md` on every state change (debounced 500ms), and every harness session injects the file at start. A UserPromptSubmit hook re-injects when the file is newer than session start — so context stays live, not stale. Includes a knowledge registry (LLM-classified on issue creation) showing which workspace owns which feature, and an advisory compliance audit hook that nudges agents toward memory-first behavior when past-tense triggers appear in user prompts.

**4. HTML Artifacts.** Agents can now publish their output as inspectable HTML artifacts via `pan artifacts`. Real validation — secret scanning, size cap, asset path linting — gates publication. Artifacts get isolated origins (`/s/<slug>` and `/a/<slug>`) and full provenance (`{issueId, agentRole, runId, harness, supersedes}`). Share with one URL, audit at any time.

"What competitors do as a briefing-once-at-startup snapshot, we do as a live system," Becker added. "The dashboard is the source of truth and every agent — Claude Code, Pi, the next thing — gets the live view, refreshed on every change, with the same memory and docs and registry behind it."

**Available now:** `pan install` upgrades existing installations in place. New installs get the system by default.

Source: https://github.com/eltmon/panopticon-cli

---

## External FAQ

### What changes for an existing Panopticon user?

`pan install` migrates `~/Projects/.claude/{skills,agents,CLAUDE.md}` to `~/.panopticon/context/global/`. Existing projects under `~/Projects/` are auto-registered with the new project system. Existing workspaces continue to work; the new briefing file injects automatically on the next session start. No code changes required in your projects.

### Does this work with my non-Anthropic model?

Yes. The briefing is plain markdown — Claude Code reads it via `--append-system-prompt-file`, Pi reads it at session start. Any harness that accepts a system-prompt append can use it. Codex, Cursor, and Gemini are on the v2 roadmap.

### What's the cost?

Free. The docs RAG ships pre-built — no per-install indexing cost. The compliance audit is text-only with no extra LLM calls. The knowledge registry uses about **\$0.001 per new issue** for one Haiku classification call, capped per-day; disable it entirely with `registry.classification.enabled = false` if you prefer.

### Will the briefing leak my project secrets?

No. The briefing pulls from the memory store (PAN-1052), which already scrubs and ranks observation content. HTML artifacts gate on a secret scanner before publish. Both are auditable via `pan briefing` and `pan artifacts list`.

### How do I disable the compliance audit?

`pan compliance set-mode off`. The default is `advisory` (logs misses, nudges next prompt, never blocks). `enforcing` mode — which blocks `git log` / `grep` / `Read` calls until a memory search runs — ships in Phase 2.

### Can I customize the briefing?

Yes. `pan briefing edit` opens the global header template in your `$EDITOR`. The dynamic sections (workspaces, registry, recent activity) re-render automatically. The trigger phrase list for the compliance audit is editable via `pan compliance triggers add "<phrase>"`.

### What about projects with no internet access?

The docs index ships inside the npm package. Memory and briefing are local SQLite + markdown. No network required for the core loop. The Haiku classifier for the knowledge registry needs network; turn it off with `registry.classification.enabled = false` for fully offline operation.

### Where can I see what an agent will actually receive at spawn?

`pan context diff` shows the full assembled prompt for each registered harness — system prompt, append, memory injection, briefing, docs preload. The dashboard's new Context tab renders the same view live with side-by-side per-harness panes.

---

## Internal FAQ

### Why ship all four together instead of incrementally?

They're coupled at the user-experience level. Shipping context distribution without the briefing leaves users with a layered config they can't see. Shipping the briefing without docs RAG means agents still guess at how to use Panopticon. Shipping artifacts without the briefing means there's no entry point on the Home tab to discover them. The four go together; users get one coherent capability rather than four half-features.

### What's the parallelization strategy?

All four issues planned in parallel with **GPT-5.5** (`pan plan --auto --model gpt-5.5`), then swarmed in parallel with wave-scheduled work agents (`pan swarm --model gpt-5.5 --auto-advance --max-slots 4`). Cloister auto-spawns review → test → ship; merge coordination handled by the orchestrating session (override of the standing humans-only-merge rule for this epic specifically). Risk of merge collisions is handled at review time — the workspaces are isolated git worktrees, so there's no live conflict surface.

### What happens if one of the four fails?

The epic is failure-isolated:

- **PAN-1201** (distribution) is the only one with a hard downstream dependency. PAN-1204 prefers to write `session-context.md` inside the new `~/.panopticon/context/global/` directory; if PAN-1201 fails, PAN-1204 falls back to `~/.panopticon/session-context.md` at the root and is migratable later.
- **PAN-1203** (docs RAG) and **PAN-1205** (artifacts) are independent; either can ship without the others.
- **PAN-1204** depends on **PAN-1052** (memory store), which is already on main. PAN-1052 has been verified end-to-end against requirements; the APIs PAN-1204 needs (`writeObservation`, `readCurrentStatus`, `readRecentObservations`, `searchMemory`, `memory.observation_created` event) are all present.

### Why GPT-5.5 across the board instead of Claude Opus?

Cost. The four issues together are roughly 50–80 beads of work. Opus on that scope is multiple hundreds of dollars; GPT-5.5 is a fraction. We've shown comparable correctness on Panopticon work of similar shape via Cloister telemetry. Sub-roles that need precision (`work.sub.inspect` = haiku for tight loops; security-review sub-role = expensive) keep their configured assignments rather than being force-overridden.

### How does this differ from Subspace?

Five things:

1. **Live briefing**, not snapshot-at-startup. Theirs goes stale within hours; ours updates on state change and re-injects when newer than session start.
2. **Honest framing.** Theirs claims cross-workspace inlining but only delivers RAG. Ours explicitly says *"sibling state is queryable via `pan memory search`"* — no false promise.
3. **Implemented knowledge registry.** Theirs is a stub that's always empty in the shipped runtime. Ours actually LLM-classifies on issue creation.
4. **Real artifact validation.** Theirs validates JSON metadata only. Ours scans secrets, enforces size, lints asset paths.
5. **Compliance audit.** Theirs has memory-first triggers in the prompt but no enforcement (models comply unevenly). Ours has a Stop-hook that observes misses and a UserPromptSubmit nudge with mode controls (`off` / `advisory` / `enforcing`).

### What's out of scope for v1?

- Cross-harness beyond Claude Code + Pi (Codex / Cursor / Gemini follow in v2).
- Enforcing-mode compliance audit (advisory only in v1).
- Cross-repo docs RAG (Panopticon's own docs only).
- Embedding model swaps without index rebuild.
- Dashboard inline-editing of the briefing template (CLI editing only in v1).
- Per-user briefing personalization (v1 is per-machine).
- HTML artifact rich-validation linting beyond the v1 list (PR-FAQ-style HTML, runnable embeds, etc.).

### How will we measure success?

Three KPIs over the first 30 days post-launch:

1. **Cold-start friction:** median time from agent spawn to first non-discovery tool call. Target: 50% reduction vs current baseline.
2. **Docs RAG hit rate:** proportion of *"how do I X in Panopticon"* prompts where the retrieved docs were rated relevant by the agent's first follow-up. Target: ≥ 70% relevance.
3. **Compliance miss rate:** observations logged where past-tense triggers fired but `pan memory search` was skipped. Trending down month-over-month.

### What's the rollback plan?

Per-feature:

- **PAN-1201:** the migration is one-shot and reversible — `pan context migrate --rollback` restores `~/Projects/.claude/` from the backup it took on initial migration.
- **PAN-1203:** `pan docs disable` silences the hook globally; `npm run build:docs-index` regenerates the shipped index if it goes bad.
- **PAN-1204:** the briefing file is just a markdown file; delete it and the wrapper injection is a no-op. The compliance audit has an `off` mode.
- **PAN-1205:** artifact publication is opt-in per-call (`pan artifacts publish`); existing files are not touched.

Epic-wide rollback: `pan release stable --version 0.5.X` reverts the npm package to the prior stable release; user-side state migrations are forward-compatible (additive only).

### Why is the merge coordination automated for this epic?

User-explicit override of the standing humans-only-merge rule. The orchestration session is babysitting all four through plan → swarm → review → test → ship → merge as a single coordinated launch. Standard human-merge resumes after PAN-1200 closes.

---

## Acceptance Criteria (Epic-Wide)

- All four children merged to main (#1201, #1203, #1204, #1205)
- `pan sync` no longer references `sync.devroot`
- `~/.panopticon/context/global.md` round-trips to `~/.claude/CLAUDE.md` and Pi's equivalent
- A newly-spawned agent in any registered project receives the live session-context briefing
- Asking an agent *"how do I X in Panopticon?"* triggers docs-RAG injection
- An agent can produce an HTML artifact, validate it, publish it, and the dashboard renders the workspace-record card linking to it
- Compliance audit hook fires when past-tense triggers match without a preceding `pan memory search`; observations logged

---

*This document is a working-backwards artifact written before the feature ships. It will be updated through the orchestration cycle and finalized when PAN-1200 closes.*
