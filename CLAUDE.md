# Overdeck CLI - Development Guidelines

> **Note:** Universal and dev-scope engineering rules (async tmux, no execSync in server, fake timers, worktree/stash discipline, Karpathy rules, …) live in [`sync-sources/rules/`](sync-sources/rules/) and reach every session via `pan sync` → `~/.claude/CLAUDE.md`. This file holds only project-specific essentials; everything else is one link away.

> **Knowledge bundle (OKF):** Project knowledge lives in the OKF bundle at [`../overdeck-knowledge`](../overdeck-knowledge) (remote `eltmon/overdeck-knowledge`), pointed to by [`.okf.yml`](.okf.yml). Use `/okf extract "<query>"` to pull cited context and `/okf author`/`/okf sync`/`/okf study` to maintain it. Edit through `/okf author`; the upstream viewer does not preserve YAML formatting losslessly.

## Engineering Philosophy

- **No bandaids.** Fix root causes. Never paper over symptoms with fallbacks, special cases, or manual workarounds — every workaround is a bug you chose not to fix. If a tool/test/flow is broken, fix it; don't route around it.
- **Never do agent work — fix the system.** When a pipeline agent produces a bad result, fix the prompt/gate/flow that allowed it. Ask "why did the system allow this?" before touching output.
- **Deliver complete features.** Partial implementation of an issue is zero value; don't signal done until all of it is done.
- **JSONL session files are sacred.** Never delete/truncate `~/.claude/projects/*/*.jsonl` — irreversible conversation history.
- **Commit and push when working on main.** Finish a coherent change, verify it builds, commit, push — unpushed local commits cause divergence against the pipeline's merges.

## Critical Operational Facts

- **tmux socket:** agents live on `tmux -L overdeck` (the default socket shows nothing). Attach/capture with `-L overdeck`.
- **Dashboard runs Node 22 dist only — never Bun, never tsx** (`@lydell/node-pty` + circular ESM). `pan up`/`pan reload` handle it; after server changes run `npm run build` first. Startup/triage: [docs/OVERDECK_DEV_SOP.md](docs/OVERDECK_DEV_SOP.md).
- **Releases:** always `pan release stable --version X.Y.Z`, then push main + tag. Never manual tags, `npm version`, or `--no-verify`; hooks enforce it.
- **Deep-wipe** (`POST /api/issues/:id/deep-wipe`) destroys workspace, branches, and tracker state irreversibly. Never call it — or any destructive HTTP request — speculatively.
- **Issue tracker:** GitHub Issues (`PAN-<n>` = `eltmon/overdeck#<n>`), not Linear. Issue→project resolution reads `issue_prefix` in `projects.yaml`.
- **`pan start <id>`** is the paved road: plans if unplanned (`--plan interactive|auto|skip`), then starts work. `pan plan` is plan-only. Verify flags with `pan <verb> --help`.

## Project Structure

- **Stack:** TypeScript, Node 22+, React dashboard, SQLite, Effect.js. Package manager: Bun (9 workspaces incl. `packages/contracts`, `packages/effect-acp`, `apps/desktop`).
- **Build:** `npm run build` (tsdown + Vite). **Dev:** `npm run dev`.
- **Quality gates** (must pass before `pan done`): `npm run typecheck`, `npm run lint`, `npm test`.
- **Workspaces** are git worktrees at `workspaces/feature-<issue>/` with their own `bun install` — never symlink node_modules. Details: [docs/WORKSPACE-CONTAINERS.md](docs/WORKSPACE-CONTAINERS.md).

## Key Invariants (one-liners)

- The canonical xBRIEF spec on `overdeck-state` is **immutable after planning**; item status lives in the project-side per-issue record's `statusOverrides`. [docs/XBRIEF.md](docs/XBRIEF.md)
- Every state domain has **one read door and one write door**; never touch stores directly. [docs/API-SURFACE.md](docs/API-SURFACE.md)
- The post-merge lifecycle runs **at most once per merge** — keep `tests/unit/lib/cloister/in-flight-guard.test.ts` green. [docs/MERGE-WORKFLOW.md](docs/MERGE-WORKFLOW.md)
- `.claude/agents/` + `.claude/skills/` in worktrees are **sync targets** populated from `sync-sources/`; three shipped subagents hardcode `model: haiku` (breaks on CLIProxy-routed models — prefer built-in `Explore`/`general-purpose` for ad-hoc exploration).
- Pipeline membership, decisions, and workspace tables each have a canonical resolver — never derive independently. [docs/PIPELINE-MEMBERSHIP.md](docs/PIPELINE-MEMBERSHIP.md), [docs/DECISIONS.md](docs/DECISIONS.md), [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md)

## Topic Index

| Topic | Doc |
| --- | --- |
| Harnesses (claude-code, ohmypi, codex, acp, kimi-code), ToS gate | [configuration/harnesses.mdx](configuration/harnesses.mdx), [reference/harness-landscape.mdx](reference/harness-landscape.mdx) |
| Roles, sub-roles, agent taxonomy, review architecture | [docs/ROLES.md](docs/ROLES.md), [docs/REVIEW-AGENT-ARCHITECTURE.md](docs/REVIEW-AGENT-ARCHITECTURE.md) |
| Skills ↔ CLI convention (`sync-sources/skills/pan-<verb>/`) | [docs/SKILLS-CONVENTION.md](docs/SKILLS-CONVENTION.md) |
| Agent message delivery (PTY supervisor, Channels fallback, blocking-menu guard) | [docs/AGENT-MESSAGE-DELIVERY.md](docs/AGENT-MESSAGE-DELIVERY.md) |
| Dashboard server architecture, WS endpoints, terminal protocol | [docs/DASHBOARD-ARCHITECTURE.md](docs/DASHBOARD-ARCHITECTURE.md) |
| Verification gate, verdict feedback routing, review convergence, auto-resume gates | [docs/PIPELINE-GATES.md](docs/PIPELINE-GATES.md) |
| Resource governor (memory gate, preemption) | [docs/RESOURCE-GOVERNOR.md](docs/RESOURCE-GOVERNOR.md) |
| Agent state planes (permanent/runtime/liveness) | [docs/AGENT-STATE-PLANES.md](docs/AGENT-STATE-PLANES.md) |
| Workspaces & projects domain, quick actions, memory homes | [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md) |
| Merge workflow, post-merge handoff, Docker cleanup, close-out | [docs/MERGE-WORKFLOW.md](docs/MERGE-WORKFLOW.md), [docs/DEFINITION-OF-DONE.md](docs/DEFINITION-OF-DONE.md) |
| xBRIEF plans, four artifacts, status lifecycle | [docs/XBRIEF.md](docs/XBRIEF.md) |
| Flywheel + order books | [docs/FLYWHEEL.md](docs/FLYWHEEL.md), [docs/ORDER-BOOKS.md](docs/ORDER-BOOKS.md) |
| Effect bridging + diagnostics ratchet | [docs/EFFECT-BRIDGING.md](docs/EFFECT-BRIDGING.md), [docs/EFFECT-DIAGNOSTICS.md](docs/EFFECT-DIAGNOSTICS.md) |
| Issue views, God View, AskUserQuestion pipeline | [docs/ISSUE-VIEW.md](docs/ISSUE-VIEW.md), [docs/GOD-VIEW.md](docs/GOD-VIEW.md), [docs/ASKUSERQUESTION-DASHBOARD.md](docs/ASKUSERQUESTION-DASHBOARD.md) |
| Telemetry write doors | [docs/TELEMETRY.md](docs/TELEMETRY.md) |
| Context layers (rules/skills distribution) | [docs/CONTEXT-LAYERS.md](docs/CONTEXT-LAYERS.md) |

## Small But Sharp

- **TLDR:** large-file Reads auto-summarize via a PreToolUse hook; for exploration use `.venv/bin/tldr context|extract` via Bash. The `tldr_*` MCP tools are not registered — don't call them (PAN-3534).
- **RTK:** when `agents.rtk.enabled`, Bash output may be compressed; re-run with `OVERDECK_RTK_ENABLED=0` for raw output.
- **Issue creation from PRDs:** reference the PRD at the top of the issue body (`**PRD:** [link]`); summarize, don't duplicate — canonical PRD is `drafts/<issue>.md` on `overdeck-state`.
- **Task enforcement:** work agents need a readable xBRIEF (start returns 422 otherwise); completion is gated on the checklist via `pan task` (`failedCheck: 'incomplete-plan-items'`).
