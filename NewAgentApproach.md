# Overdeck — Naming & Filepath Conventions Reference

> **Superseded by [PAN-1908](./.pan/drafts/PAN-1908.md).** This file was compiled as a
> pre-PAN-1908 conventions snapshot and is no longer the live source of truth for agent
> state architecture. It is preserved for historical reference only; current agents should
> read `docs/AGENT-STATE-PLANES.md`, `docs/VBRIEF.md`, and `CLAUDE.md`.

> Compiled 2026-06-14 from the live system (`~/.overdeck`, `tmux -L overdeck`)
> and the source tree (`src/lib/agents.ts`, `workspace-manager.ts`, `cloister/uat-*`,
> `roles/`). Entries marked **(code)** were confirmed against a constructing line;
> **(observed)** were confirmed from live state but not pinned to a constructor.

The single rule that drives almost everything: **every spawned thing is named
`<role-prefix>-<issue-id-lowercased>[-<suffix>]`, and the tmux session name == the
agent id == the state-dir name.** Get the prefix table right and the rest follows.

---

## 1. tmux sessions

- **Socket:** all agents live on the `overdeck` socket — always
  `tmux -L overdeck …`. The default socket (`/tmp/tmux-1000/default`) is unused
  by Overdeck; `tmux list-sessions` with no `-L` will say "no server running".
- **The session name IS the agent id.** Liveness = "does a session with this name
  exist?" — this is the source of truth, **not** `state.json.status` (which drifts).

### Session-name prefix table

| Session name | Kind | Constructor |
|---|---|---|
| `agent-<issue>` | work agent | `agent-${issueId.toLowerCase()}` **(code, agents.ts:3018)** |
| `agent-<issue>-<role>` | role agent (`-review`, `-test`, `-ship`) | `agent-${issue}-${role}` **(code, agents.ts:3019)** |
| `agent-<issue>-review` | review convoy **parent** | as above |
| `agent-<issue>-review-{correctness,performance,requirements,security}` | review convoy **sub-roles** (4) | role + subRole **(observed)** |
| `agent-<issue>-test` | test agent | role suffix |
| `agent-<issue>-ship` | merge-specialist identity (legacy token; no ship agent is spawned) | role suffix |
| `agent-<issue>-<N>` | swarm slot (`-1`, `-2`, …) — multi-agent on one issue | numeric suffix **(observed: `agent-pan-1122-1..5`)** |
| `planning-<issue>` | planning agent | prefix `planning` |
| `strike-<issue>` | strike agent (pipeline-bypass, lands on main) | `strike` prefix **(code, agents.ts:3510 — `sessionPrefix = role === 'strike' ? 'strike' : 'agent'`)** |
| `inspect-<issue>-workspace-<hash>` | per-bead inspection agent | **(observed)** |
| `conv-<YYYYMMDD>-<XXXX>` | conversation agent (`XXXX` = 4-char id) | **(observed: `conv-20260614-1216`)** |
| `flywheel-orchestrator` | the conversation-level Fix-All Flywheel | fixed name |
| `overdeck-init` | bootstrap/init session (not an agent) | fixed name |

**To select "all pipeline agents, leaving conversations + infra alone":**
```bash
tmux -L overdeck list-sessions -F '#{session_name}' \
  | grep -vE '^(conv-|flywheel-orchestrator$|overdeck-init$)'
```

---

## 2. Roles & role-instruction files

Pipeline roles: **`plan` → `work` → `review` → `test`** (+ server-side merge handoff;
there is **no** `ship.md` / ship agent — `ship` survives only as a model-routing
identity). Role prompts live in `roles/`:

```
roles/plan.md  work.md  review.md  test.md  strike.md  flywheel.md
roles/review-correctness.md  review-performance.md  review-requirements.md  review-security.md
roles/handoff.md  handoff-external.md  handoff-external-pi.md
```

- Review **sub-roles** are `roles/review-<subRole>.md`, inlined into convoy spawn
  messages (never loaded via Claude's `--agent` flag).
- `.claude/agents/` and `.claude/skills/` are **sync targets, deliberately empty**
  in this repo — Overdeck ships no ambient subagents.

---

## 3. `~/.overdeck` (OVERDECK_HOME) top-level layout

State directory shared by the host orchestrator. **Never mount this into a
workspace container** (single-Deacon invariant). Top level (observed):

| Path | Holds |
|---|---|
| `agents/<agent-id>/` | per-agent state (see §4) |
| `swarms/` | swarm-runtime entries |
| `conversations/`, `conversation-attachments/` | conversation sessions + uploads |
| `sockets/` | per-agent unix sockets (mode `0600`) — see §5 |
| `bridge-tokens/`, `secrets/`, `internal-token`, `github-app/` | auth material |
| `context/` | rendered context layers: `pi-global.md`, `codex-global.md`, global layer |
| `rules/`, `skills/`, `commands/`, `agent-definitions/` | synced harness assets |
| `memory/` | auto-memory (`MEMORY.md` + per-fact files) |
| `flywheel/`, `deacon/`, `heartbeats/`, `recovery/`, `shadow-state/` | orchestration runtime |
| `registry/` | Knowledge Registry (feature ownership) |
| `artifacts/`, `archives/`, `costs/`, `briefing/`, `handoffs/`, `logs/`, `pids/`, `locks/` | misc runtime |
| `projects.yaml` | project → repo/tracker config (also `config.yaml`, `config.toml`, `cloister.toml`) |
| `*.db` (`panopticon.db`, `cloister.db`, `event-store.db`, `events.db`, `dashboard.db`, `cache.db`, `state.db`) | SQLite stores |
| `review-status.json`, `restart-status.json`, `supervisor-watchdog.json`, `supervisor.pid` | live status files |
| `certs/`, `traefik/` | TLS + reverse-proxy for `*.pan.localhost` |
| `tldr/`, `cliproxy/`, `tts-voices.json`, `voice-settings.json`, `ui-theme.json` | feature data |

---

## 4. Per-agent state directory — `~/.overdeck/agents/<agent-id>/`

Observed contents (a planning agent):

```
state.json          # canonical agent state: role, status, issueId, paused{,Reason,At}, troubled fields
activity.jsonl       # append-only activity log
lifecycle.log        # spawn/stop/resume lifecycle events
output.log           # captured stdout
launcher.sh          # the exact command used to spawn (env exports + harness invocation)
init-prompt.txt      # the spawn/init prompt
context-pct          # current context-window % (number)
initial-context-pct  # context % at spawn
ready.json           # readiness signal
sessions.json        # harness session/transcript pointers
pending.lock         # in-flight guard
pty-token            # (supervisor-wired agents) per-agent auth token for the PTY supervisor socket
```

- **`state.json` is the agent's record but NOT the liveness oracle** — it can read
  `stopped` while the tmux session is alive (drift). Use tmux for "is it running".
- **Pause gate** (durable): `pan pause <id>` writes `paused`/`pausedReason`/`pausedAt`
  into `state.json`; deacon auto-resume skips it; `pan unpause <id>` clears it.
- **Troubled gate**: repeated crashes set `troubled` + backoff fields; `pan untroubled <id>` clears.

---

## 5. Sockets & tokens — `~/.overdeck/sockets/`

| Path | Purpose |
|---|---|
| `sockets/pty-<id>.sock` | PTY-supervisor delivery socket (preferred transport), mode `0600` **(code)** |
| `sockets/agent-<id>.sock` | legacy Claude Code Channels MCP bridge socket **(code, agents.ts:1570/1833)** |
| `agents/<id>/pty-token` | per-agent token authenticating POSTs to the supervisor socket |

Conversation sockets follow the same scheme: `agent-conv-<YYYYMMDD>-<XXXX>.sock`.
`deliverAgentMessage(agentId, message)` tries, in order: PTY supervisor → Channels
MCP → tmux `load-buffer`+`paste-buffer` fallback.

---

## 6. Workspaces & git branches

- **Workspace dir:** `<projectRoot>/workspaces/feature-<issue-id-lowercased>/`
  — `featureFolder = feature-${featureName}` **(code, workspace-manager.ts:572/1166)**.
  A git **worktree**, not a clone.
- **Feature branch:** `feature/<issue-id-lowercased>` — `branchName = feature/${featureName}`
  **(code, workspace-manager.ts:636/1458)**.
- **Each worktree has its own `node_modules`** (`bun install`, hardlinked) — never
  symlink from the main repo.
- **Primary worktree** = repo root on `main`, shared across sessions; edits there
  bypass the review pipeline.
- **Worktree discipline:** never `git checkout <other-branch>` inside a workspace
  (drifts HEAD off the feature branch). Verify with `git branch --show-current` +
  `git rev-parse --show-toplevel`.

---

## 7. The `.pan/` directory & the four-artifact vBRIEF model

`.pan/` (under the project root, and a workspace copy) is the operational state dir.
Subdirectories observed/required: `.pan/events/`, `.pan/review/`, `.pan/prompts/`,
`.pan/drafts/`, `.pan/specs/`, `.pan/continues/`, `.pan/context/`.

### The four artifacts (PAN-1124 single-spec-on-main) — keep distinct

| Artifact | Path | Writer | Mutability |
|---|---|---|---|
| **PRD draft** (`.md`) | `<root>/.pan/drafts/<issue>.md` | human / planning agent | free-form, human-mutable |
| **vBRIEF spec** (`.json`) on main | `<root>/.pan/specs/<YYYY-MM-DD>-<ISSUE>-<slug>.vbrief.json` | pipeline only | immutable after planning; only `plan.status` changes |
| **project-side continue** (`.json`) | `<root>/.pan/continues/<issue-lowercased>.vbrief.json` | pipeline | resume point, decisions, hazards, sessionHistory |
| **workspace-side continue** (`.json`) | `<workspace>/.pan/continue.json` | pipeline + work agent | session state + `statusOverrides` map |

- `readWorkspacePlan()` = main spec + workspace `statusOverrides` overlay.
  Item/sub-item completion writes **only** to the workspace continue file's
  `statusOverrides` — it cannot mutate the immutable spec.
- **Gitignore:** `.pan/continue.json` is gitignored, never tracked. `.pan/specs/`,
  `.pan/continues/`, `.pan/drafts/` **are** tracked (canonical record).
- Other `.pan/` files: `.pan/review/<runId>/context.json` (+ per-role `<role>.md`
  reports — §8), `.pan/agent-mcp.json` (Channels MCP config when diagnostic opt-in).
- **Legacy / read-only fallback** (do not write): `.pan/spec.vbrief.json` (pre-1124
  migration compat), `.planning/plan.vbrief.json` (**deleted**), project-root
  `vbrief/{proposed,active,completed,cancelled}/`, `docs/prds/{planned,active}/`.

### `plan.status` lifecycle (a JSON field, files do NOT move directories)
```
draft (.pan/drafts/*.md) → proposed → approved → active/running → completed
                                 └────────→ cancelled ←──────────────┘
```

---

## 8. Review convoy & output files

- A review run is a **convoy**: parent `agent-<issue>-review` + 4 sub-role sessions
  (`-review-correctness` / `-performance` / `-requirements` / `-security`).
- Shared context: `.pan/review/<runId>/context.json` **(code, cloister/review-context.ts)**.
- Each sub-role **must** write findings to `.pan/review/<runId>/<role>.md` — the
  only file a review agent may write (it must not modify code under review).
- Synthesis is deterministic deacon-side from the on-disk reports (PAN-1864) — never
  depend on a hung synthesis LLM.

---

## 9. UAT candidate branches & codenames

- **Branch:** `uat/<label>-<codename>-<MMDD>` **(code, flywheel-merge-order.ts:92,
  cloister/uat-generation-engine.ts)** — e.g. `uat/pan-slate-0612`, `uat/pan-ember-0614`.
  - `<label>` = project label (e.g. `pan`).
  - `<codename>` = generation codename (slate/ember/thorn/cobalt/vale/moss…),
    collision-checked against `git ls-remote --heads origin 'uat/*'`.
  - `<MMDD>` = month/day.
- **Workspace/Traefik:** the folder `uat-<label>-<codename>-<MMDD>` yields the host
  `uat-<label>-<codename>-<MMDD>.pan.localhost` **(code, cloister/uat-stack.ts)**.
- A generation is a throwaway branch off main with each candidate merged in;
  **promotion** merges the `uat/*` branch into main as one no-ff commit.

---

## 10. Issue-ID conventions & tracker resolution

| Prefix | Tracker | URL |
|---|---|---|
| `PAN-<n>` | GitHub `eltmon/overdeck` | `…/issues/<n>` — **`PAN-<n>` IS GitHub `#<n>`** |
| `KRUX-<n>` | GitHub `eltmon/krux` | `…/issues/<n>` |
| `MIN-<n>` | Linear (Mind Your Now) | canonical `url` from tracker API |
| `AUR-<n>` | Linear (Auricle) | canonical `url` from tracker API |

- Resolution (`resolveProjectFromIssue`): match `linear_team` in `projects.yaml`,
  else derive prefix from the project key (uppercased, hyphens removed).
- Issue ids are **lowercased** everywhere they become a filesystem/session name
  (`PAN-1758` → `agent-pan-1758`, `feature/pan-1758`, `feature-pan-1758/`).
- Run ids: `RUN-<n>` (flywheel). PRs: GitHub `#<n>`; GitLab MR `!<n>` (MYN).

---

## 11. Beads (bd) tracker

- Per-workspace task DB: `.beads/issues.jsonl` (work agents can't start without it
  → start-agent returns 422 if absent).
- `.gitattributes` declares `.beads/issues.jsonl merge=beads` (the driver is
  currently inert/unconfigured → conflicts; PAN-1901).
- Regenerable state: on a merge conflict, `git checkout --theirs .beads/` is safe.

---

## 12. Context layers (placement shorthand → destination)

| You say | Destination |
|---|---|
| **universal rule** | `sync-sources/rules/<name>.md`, `scope: universal` (ships to every machine/project) |
| **dev rule** | `sync-sources/rules/<name>.md`, `scope: dev` (overdeck checkout only) |
| **project rule** | `<root>/.pan/context/project.md` |
| **machine rule** | `~/.overdeck/context/global.md` |

Rendered (never edit directly): `~/.claude/CLAUDE.md` managed region, project
`CLAUDE.md`/`AGENTS.md`, `~/.overdeck/context/pi-global.md`, `…/codex-global.md`.
Run `pan sync` after editing; changes reach **new** sessions only.

---

## 13. Skills ↔ CLI convention

- `pan <verb>` (CLI) ↔ `/pan-<verb>` skill at `skills/pan-<verb>/SKILL.md`.
- `pan-` is also a namespace for topical/workflow skills (`/pan-workflow`, etc.).
- When the CLI changes, the wrapper skill changes in the **same commit**
  (`scripts/lint-skills.sh` enforces it in CI).

---

## 14. Build / dist artifacts

| Path | What | Runtime |
|---|---|---|
| `dist/dashboard/server.js` | dashboard server (entry) | **Node 22 only** (node-pty + circular ESM) |
| `dist/dashboard/deacon-*.js` | deacon chunk (separate bundle) | — |
| `dist/pty-supervisor.js` | PTY supervisor (`node dist/pty-supervisor.js claude …`) | Node 22 only |
| `dist/cli/*` | the `pan` CLI | — |
| `packages/contracts/dist/*` | `@overdeck/contracts` shared schemas | rebuild after editing contracts |

Build: `npm run build` (tsdown for CLI/server/contracts, Vite for frontend).
`pan up` runs the built server under Node 22; `pan reload` = build + restart.

---

## 15. Release artifacts

- Tags: `vX.Y.Z` (annotated). Notes: `.release/<tag>.md` (committed; pre-push hook
  enforces matching `package.json` versions + committed notes).
- Cut releases **only** via `pan release stable --version X.Y.Z` — never manual
  `git tag` / `npm version` / `npm publish`.

---

## Appendix — the prefix → kind cheat sheet (most-used)

```
agent-<issue>                                   work
agent-<issue>-review[-{correctness|performance|requirements|security}]   review convoy
agent-<issue>-test                              test
agent-<issue>-ship                              merge identity (no live agent)
agent-<issue>-<N>                               swarm slot
planning-<issue>                                plan
strike-<issue>                                  strike (bypass → main)
inspect-<issue>-workspace-<hash>                inspection
conv-<YYYYMMDD>-<XXXX>                           conversation
flywheel-orchestrator / overdeck-init          infra (leave alone)
workspaces/feature-<issue>/  +  branch feature/<issue>     workspace
uat/<label>-<codename>-<MMDD>                    UAT candidate branch
~/.overdeck/agents/<agent-id>/state.json       agent state (NOT the liveness oracle)
```
