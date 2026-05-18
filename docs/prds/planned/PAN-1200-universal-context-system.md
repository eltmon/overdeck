# PAN-1200 — Universal Context System (Epic)

**Issue:** [PAN-1200](https://github.com/eltmon/panopticon-cli/issues/1200)
**Status:** Planned
**Date:** 2026-05-18
**Author:** Ed Becker

---

## Vision

Make Panopticon a coherent multi-harness, multi-project context system. Every agent — Claude Code, Pi, future harnesses — receives the same global rules, the same project-specific guidance, the same live workspace briefing, and the same Panopticon-docs awareness. Every agent can produce inspectable HTML artifacts. The system deprecates the `sync.devroot` model entirely and stops assuming projects live under `~/Projects/`.

## Problem

Today an agent launched in any Panopticon workspace shows up cold:

- It doesn't know what was decided last week (memory exists per-issue but its retrieval is uneven)
- It doesn't know what other agents are doing in adjacent workspaces
- It doesn't know the Panopticon-specific way to do things (no docs RAG)
- The config that's supposed to provide context (CLAUDE.md, skills, rules) only reaches Claude Code, and only via filesystem walks
- `~/Projects/.claude/` has skills and agents in it, but `sync.devroot` is unset so nothing pushes them to `~/.claude/` or to harness-specific locations
- The whole `~/Projects/` assumption breaks down for projects that live elsewhere (clients/, archives/, recovered repos)
- Agents can't produce visual or shareable outputs — only text

## Relationship to PAN-1052

PAN-1052 (in progress) is the **memory-and-observations substrate**: per-turn LLM-extracted observations stored in FTS5, workspace status rollups every 4 turns, `MEMORY_CONTEXT` injection at spawn + per-prompt, `HarnessAdapter` / `TranscriptSource` interface. This epic builds **on top of** that substrate:

- Child 1 (distribution) doesn't touch the memory pipe — separate concern
- Child 2 (docs RAG) reuses PAN-1052's UserPromptSubmit hook runner with a different corpus
- Child 3 (Home + briefing) consumes PAN-1052's status rollups + adds the compliance audit hook
- Child 4 (HTML artifacts) is mechanistically independent but threads its metadata through PAN-1052's per-issue store

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  User runs:  claude   |   pi   |   future harness                       │
│                  │              │                                       │
│            wrapper script (per harness)                                 │
│                  │              │                                       │
│   ──────── system-prompt-append flag ──────────                         │
│                  │              │                                       │
│                  ▼              ▼                                       │
│       ~/.panopticon/session-context.md  ◄── live-updated by dashboard  │
│            (assembled from PAN-1052 status + workspace state)           │
└─────────────────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼──────────────────┬──────────────────┐
        ▼                 ▼                  ▼                  ▼
  Context Distribution    Docs RAG       Home Tab +        HTML Artifacts
  (Child 1)              (Child 2)       Briefing          (Child 4)
                                         (Child 3)
        │                 │                  │                  │
        ▼                 ▼                  ▼                  ▼
  ~/.panopticon/    ~/.panopticon/    ~/.panopticon/      ~/.panopticon/
  context/          docs/             session-context.md  artifacts/
  ├─ global.md      ├─ index.sqlite                       └─ index.sqlite
  ├─ skills/                                              + /s/<slug>
  └─ agents/                                              + /a/<slug>

                          │
                          ▼
                    PAN-1052 memory store (existing)
                    ~/.panopticon/memory/<projectId>/<issueId>/
                    ├─ memory-search.db (FTS5)
                    ├─ status.json
                    └─ observations/
```

## Children

| # | Title | One-liner |
|---|---|---|
| [PAN-1201](https://github.com/eltmon/panopticon-cli/issues/1201) | Hybrid context distribution | Replace devroot with global/project/workspace layers; single-source → harness-specific render |
| [PAN-1203](https://github.com/eltmon/panopticon-cli/issues/1203) | Panopticon-docs RAG | Ship prebuilt index; UserPromptSubmit hook injects top-k snippets |
| [PAN-1204](https://github.com/eltmon/panopticon-cli/issues/1204) | Home tab + live briefing | Dashboard landing; live session-context.md; knowledge registry; compliance audit hook (advisory) |
| [PAN-1205](https://github.com/eltmon/panopticon-cli/issues/1205) | HTML artifacts | `pan artifacts` CLI; real validation; isolated `/s/<slug>` + `/a/<slug>` origins; full provenance |

## v1 Harness Scope

Claude Code (primary) + Pi (alternative, PAN-636). Codex / Cursor / Gemini / OpenCode are explicitly deferred to Phase 2. The distribution model in Child 1 is designed to accommodate them without redesign.

## Differentiation vs Prior Art

Borrows the briefing structure and HTML-artifacts mechanism from Subspace, with concrete improvements at every cut corner Subspace's own agent confirmed:

| Concern | Subspace | Panopticon |
|---|---|---|
| Memory extraction cost ceiling | None | Per-day cap + non-substantive-turn short-circuit |
| Briefing freshness | Written once at session start | Live-updated on state change; re-injected on prompt if newer |
| Knowledge registry | Stubbed (template section reserved but never populated) | LLM-classify on issue creation; populated and surfaced |
| Artifact validation | JSON metadata only | Secret scan, size enforce, asset-path lint, optional strict mode |
| Artifact provenance | None (just file path + slug) | `{issueId, agentRole, runId, harness, supersedes}` |
| Compliance enforcement | Aspirational prompt text | Advisory Stop-hook with `compliance.miss` logging + next-prompt nudge |
| Workspace deletion/rename | Soft delete only; orphans on rename | Stable workspaceId FKs; rename = display update; delete = cascade or archive |
| Cross-workspace framing | Misleading ("you can see siblings") | Honest ("siblings are searchable via `pan memory search --all-workspaces`, NOT inlined") |
| Multi-harness coverage | Claude Code + Codex + OpenCode; no Cursor/Gemini | Claude Code + Pi in v1; Codex/Cursor/Gemini designed-for in v2 |

## Acceptance Criteria for the Epic

The epic is complete when all four children are merged and:

- `pan sync` no longer references `sync.devroot`; the config field is deprecated with a warning on read
- `~/.panopticon/context/global.md` round-trips to `~/.claude/CLAUDE.md` (and Pi's equivalent) via `pan sync`
- A newly-spawned agent in any registered project receives the live session-context briefing on first turn
- Asking any agent "how do I X in Panopticon?" triggers docs-RAG injection (when X matches the configured trigger set)
- An agent can produce an HTML artifact, validate it, publish it to `panopticon.localhost/s/<slug>`, and the dashboard renders the workspace-record artifacts tab linking to it
- Compliance audit hook fires when past-tense triggers match without preceding memory search; misses logged to PAN-1052's store; next-turn soft warning prepended

## Open Questions

- [ ] Pi-specific context paths: Pi currently reads `~/.claude/skills/`; does it grow its own paths in v1 or share Claude's? (Spec assumes shared until Pi diverges.)
- [ ] Embedding model for docs RAG: local (gte-small, 384-dim) or remote (OpenAI text-embedding-3-small)? Local has zero runtime cost; remote has better recall. Default to local for v1.
- [ ] Knowledge registry classifier model: Haiku 4.5 (matches PAN-1052) vs Sonnet 4.6 (better feature extraction). Haiku default; switch if precision suffers.
- [ ] Compliance audit hook: should the soft warning be in the next user's prompt content (visible) or in a system-level append-block (hidden from the user)? Default: hidden, configurable.
- [ ] HTML artifacts: do we want Tailscale Funnel integration in v1 or defer? Spec defers to Phase 2.

## Phasing

The four children can ship independently:

1. **Child 1 first** (unblocks the others by establishing the harness adapter + sync schema)
2. **Children 2 and 3 in parallel** (both consume Child 1's hook plumbing)
3. **Child 4 last** (independent, but the dashboard workspace-inspector tab benefits from Child 3's Home tab work)

## Files Likely Touched

Epic-level — see each child's PRD for specifics:

- `src/lib/runtimes/claude-code.ts`, `src/lib/runtimes/pi.ts` (wrapper integration)
- `src/lib/launcher-generator.ts` (append-flag threading)
- `src/cli/commands/sync.ts`, `src/cli/commands/context.ts` (new), `src/cli/commands/docs.ts` (new), `src/cli/commands/artifacts.ts` (new), `src/cli/commands/registry.ts` (new)
- `src/dashboard/server/routes/context.ts` (new), `src/dashboard/server/routes/artifacts.ts` (new), `src/dashboard/server/routes/registry.ts` (new), `src/dashboard/server/routes/home.ts` (new)
- `src/dashboard/frontend/src/pages/HomePage.tsx` (new), `src/dashboard/frontend/src/pages/ContextTab.tsx` (new), `src/dashboard/frontend/src/components/ArtifactsTab.tsx` (new)
- `packages/contracts/src/types.ts` (Artifact, ContextLayer, RegistryEntry, ComplianceMiss types)
- `infra/traefik/dynamic/*.toml` (route `/s/<slug>` and `/a/<slug>` to different origins)
