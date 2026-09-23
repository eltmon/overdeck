# Overdeck CLI - Development Guidelines

> **Note:** Universal and dev-scope engineering rules (async tmux, no execSync in server, fake timers, worktree/stash discipline, Karpathy rules, …) live in [`sync-sources/rules/`](sync-sources/rules/) and reach managed sessions through explicit launch context; `pan sync` updates only Overdeck-owned context artifacts. This file holds only project-specific essentials; everything else is one link away.

> **Knowledge bundle (OKF):** Project knowledge lives in the OKF bundle at [`../overdeck-knowledge`](../overdeck-knowledge) (remote `eltmon/overdeck-knowledge`), pointed to by [`.okf.yml`](.okf.yml). Use `/okf extract "<query>"` to pull cited context and `/okf author`/`/okf sync`/`/okf study` to maintain it. Edit through `/okf author`; the upstream viewer does not preserve YAML formatting losslessly.

**Overdeck stores no status it can derive: state is what git, the tracker, the PR, and the terminal backend say.**

## Engineering Philosophy

- **Deliver complete features.** Partial implementation of an issue is zero value; don't signal done until all of it is done.
- **JSONL session files are sacred.** Never delete/truncate `~/.claude/projects/*/*.jsonl` — irreversible conversation history.
- **Commit and push when working on main.** Finish a coherent change, verify it builds, commit, push — unpushed local commits cause divergence against the pipeline's merges.

## Critical Operational Facts

- **Terminal backend:** Herdr is the default and is strict — no binary/socket means launches fail with `pan install` in the error, never a silent tmux fallback; `pan install`/`pan sync` own the binary, `~/.config/herdr/config.toml` (`resume_agents_on_restore = false`), the `<session>-herdr.service` unit and the pilot integrations; `pan doctor` FAILs when Herdr is selected but unavailable. tmux only via `terminal.backend: tmux`; legacy tmux agents live on `tmux -L overdeck`.
- **Dashboard runs Node 22 dist only — never Bun, never tsx** (`@lydell/node-pty` + circular ESM). `pan up`/`pan reload` handle it; after server changes run `npm run build` first.
- **Releases:** always `pan release stable --version X.Y.Z`, then push main + tag. Never manual tags, `npm version`, or `--no-verify`; hooks enforce it.
- **Deep-wipe** (`POST /api/issues/:id/deep-wipe`) destroys workspace, branches, and tracker state irreversibly. Never call it — or any destructive HTTP request — speculatively.
- **Issue tracker:** GitHub Issues (`PAN-<n>` = `eltmon/overdeck#<n>`), not Linear. Issue→project resolution reads `issue_prefix` in `projects.yaml`.
- **`pan start <id>`** is the paved road: plans if unplanned (`--plan interactive|auto|skip`), then starts work. `pan plan` is plan-only. Verify flags with `pan <verb> --help`.
- **Workspace creation UI:** the sidebar `+`, command-palette action, and per-project button navigate to `/workspaces/new`; project-scoped entry points preselect with `?project=<key>`. Project creation UI at `/projects/new` (sidebar `+`, workspace-page chips, HomePage button) with `?mode=` query params for clone/existing/new tabs; see [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md) "Creating a project".
- **Project creation is one core, two halves:** `src/lib/projects/create.ts` resolves (read-only, safe per keystroke) and `create-perform.ts` writes (clone/init, register, `finishProjectSetup`). CLI and dashboard both go through them — never a second registration path. Failures are typed (`create-errors.ts`); a partial registration is repaired with `pan project finish-setup <key>`, never by cloning again. Details: [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md).

## Project Structure

- **Stack:** TypeScript, Node 22+, React dashboard, SQLite, Effect.js. Package manager: Bun (9 workspaces incl. `packages/contracts`, `packages/effect-acp`, `apps/desktop`).
- **Build:** `npm run build` (tsdown + Vite). **Dev:** `npm run dev`.
- **Quality gates** (must pass before `pan done`): `npm run typecheck`, `npm run lint`, and `npx vitest run <the test files you touched>`. Never run the full `npm test` on the host: it runs once, on CI, against the PR head, and a red CI test job returns as verification feedback (`verification.tests`, PAN-3965 — [docs/PIPELINE-GATES.md](docs/PIPELINE-GATES.md)).
- **Workspaces** are git worktrees at `workspaces/feature-<issue>/` with their own `bun install` — never symlink node_modules.
- **Planning artifacts** (drafts, specs, continues, orders, notes, backlog sequence) live under `.pan/` in the project repo (or the configured plan-home repo for polyrepo projects), committed on the feature branch.

## Key Invariants (one-liners)

- `sessions.json` is the append-only session index (only an explicit operator reset may truncate it); there is no `session.id`; close-out prunes caches, never state or transcripts. Entries carry the transcript's absolute path, recorded at session start by each harness's capture point; the resolver (`src/lib/agents/transcript-resolver.ts`) prefers it over per-harness path formulas, which apply only to pre-PAN-3959 entries.
- The resource governor holds dispatch during memory or CPU saturation, and every local Vitest run enters the shared CPU admission queue. See "Agent Auto-Resume Gates" in [docs/PIPELINE-GATES.md](docs/PIPELINE-GATES.md).
- `.claude/agents/` + `.claude/skills/` in worktrees are **sync targets** populated from `sync-sources/`; shipped subagent definitions carry no `model:` pin — they inherit the session model so Cloister routing applies (prefer built-in `Explore`/`general-purpose` for ad-hoc exploration).
- Project CI state reaches Command Deck rows through the shared read-model event path (`ciByProjectKey` → `/ws/rpc`); webhook observations and server-side REST repair feed it, never frontend polling. [docs/EXTERNAL-EVENT-STREAM.md](docs/EXTERNAL-EVENT-STREAM.md)
- The per-issue **pipeline journal** (`src/lib/cloister/pipeline-journal.ts`, `<workspace>/.overdeck/pipeline.jsonl`) is the one piece of stored pipeline state: append-only, written at the moment of the action, event-fired on `pipeline-notifier`, never authority — where it disagrees with the PR, the PR wins. Nothing repairs it and nothing rewrites it. [docs/PIPELINE-GATES.md](docs/PIPELINE-GATES.md)
- Delegation goes through `pan worker run` (a registered, issue-linked agent that reports back); `pan spawn` stays the foreman's pane-only item worker.
- One module answers agent liveness and idleness — `src/lib/agents/liveness.ts` (session + live pane + harness process in the pane subtree; idle = stale work activity, never the mirror label alone). Agent state is written only after the terminal-backend session exists — there are no placeholder rows — and supervisor-launched agents write `stopped` from the supervisor's own `exited` lifecycle event, never inferred.

## Topic Index

| Topic | Doc |
| --- | --- |
| Harnesses (claude-code, ohmypi, codex, acp, kimi-code), ToS gate | [configuration/harnesses.mdx](configuration/harnesses.mdx), [reference/harness-landscape.mdx](reference/harness-landscape.mdx) |
| Roles, sub-roles, agent taxonomy, review architecture | [docs/ROLES.md](docs/ROLES.md), [docs/REVIEW-AGENT-ARCHITECTURE.md](docs/REVIEW-AGENT-ARCHITECTURE.md) |
| Dashboard server architecture, WS endpoints, terminal protocol | [docs/DASHBOARD-ARCHITECTURE.md](docs/DASHBOARD-ARCHITECTURE.md) |
| Terminal backends (Herdr default, tmux supported) | [docs/TERMINAL-BACKENDS.md](docs/TERMINAL-BACKENDS.md) |
| The foreman protocol for parallel-wave issues | [docs/FOREMAN.md](docs/FOREMAN.md) |
| Verification gate, verdict feedback routing, review convergence, resource governor | [docs/PIPELINE-GATES.md](docs/PIPELINE-GATES.md) |
| Workspaces & projects domain, quick actions, memory homes | [docs/WORKSPACES-AND-PROJECTS.md](docs/WORKSPACES-AND-PROJECTS.md) |
| Merge workflow, post-merge handoff, Docker cleanup, close-out | [docs/MERGE-WORKFLOW.md](docs/MERGE-WORKFLOW.md) |
| xBRIEF plans, four artifacts, status lifecycle | [docs/XBRIEF.md](docs/XBRIEF.md) |
| Effect bridging + diagnostics ratchet | [docs/EFFECT-BRIDGING.md](docs/EFFECT-BRIDGING.md), [docs/EFFECT-DIAGNOSTICS.md](docs/EFFECT-DIAGNOSTICS.md) |
| Issue views, God View | [docs/ISSUE-VIEW.md](docs/ISSUE-VIEW.md), [docs/GOD-VIEW.md](docs/GOD-VIEW.md) |
| Context layers (rules/skills distribution) | [docs/CONTEXT-LAYERS.md](docs/CONTEXT-LAYERS.md) |
| Flywheel page and loop skill | [docs/FLYWHEEL.md](docs/FLYWHEEL.md) |
| The no-loss map: every deleted verb/route/view and its new home | [docs/THE-CUT.md](docs/THE-CUT.md) |

## Small But Sharp

- **TLDR:** large-file Reads auto-summarize via a PreToolUse hook; for exploration use `.venv/bin/tldr context|extract` via Bash. The `tldr_*` MCP tools are not registered — don't call them (PAN-3534).
- **RTK:** when `agents.rtk.enabled`, Bash output may be compressed; re-run with `OVERDECK_RTK_ENABLED=0` for raw output.
- **Issue creation from PRDs:** reference the PRD at the top of the issue body (`**PRD:** [link]`); summarize, don't duplicate — canonical PRD is `.pan/drafts/<issue>.md` in the project repo.
- **Task enforcement:** work agents need a readable xBRIEF (start returns 422 otherwise); completion is gated on the checklist via `pan task`.
