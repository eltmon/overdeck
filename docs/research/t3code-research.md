# t3code Research

**Repo**: https://github.com/pingdotgg/t3code
**Author**: Ping.gg / Theo's crew (T3 stack)
**Created**: February 2026
**Status**: Very early alpha (v0.0.0-alpha.22, ~189 stars, 16 forks)
**License**: Not accepting contributions yet
**Cloned to**: `/home/eltmon/Projects/t3code`

---

## What It Is

t3code is a minimal web GUI and Electron desktop app for AI coding agents. It wraps OpenAI's `codex app-server` (JSON-RPC over stdio) and serves a React frontend over WebSocket. Currently Codex-first; Claude Code support is reserved in the contracts layer but not yet implemented.

It is a **single-agent chat UI**, not an orchestration platform. The design is clean and focused: pick a project directory, start a thread, chat with an agent. No pipelines, no issue tracking, no automation beyond what the agent itself does.

---

## Architecture

```
Browser (React + Vite)
    │ ws://localhost:3773
apps/server (Node.js)
    │ JSON-RPC over stdio
codex app-server
```

**Monorepo layout** (Turbo + Bun):

| Package | Role |
|---|---|
| `apps/server` | Node.js WebSocket server. Wraps codex app-server, serves static web app, manages provider sessions. |
| `apps/web` | React/Vite UI. Session UX, conversation rendering, client-side state. |
| `apps/desktop` | Electron shell. Spawns `t3` backend, loads web app. |
| `packages/contracts` | Shared Effect/Schema schemas and TypeScript contracts. No runtime logic. |
| `packages/shared` | Shared runtime utilities. Explicit subpath exports (`@t3tools/shared/git`). |

**Key stack choices**:

- **Bun** runtime (not Node for development)
- **Effect** framework — typed errors, structured concurrency, dependency injection throughout server
- **React 19** + Vite, TanStack Router, TanStack Query, Zustand
- **xterm.js** for integrated terminal
- **Lexical** for rich text chat input
- **SQLite** (via `@effect/sql-sqlite-bun`) for state persistence
- **`@pierre/diffs`** for inline diff rendering

---

## Feature Inventory

### Implemented

**Multi-project management**
Sidebar with project directories and thread history per project. Threads persist in SQLite. Projects sorted by directory selection.

**Agent chat threads**
Each thread is a full conversation session with a coding agent. Sessions start/stop/resume. Message queueing planned but not yet in.

**Supervised vs Full Access runtime modes**
A global mode switch in the chat toolbar:
- **Full access** — `approvalPolicy: never`, `sandboxMode: danger-full-access`. Agent runs uninterrupted.
- **Supervised** — `approvalPolicy: on-request`, `sandboxMode: workspace-write`. Agent pauses at each shell command or file write and prompts the user in-app to approve or deny.

This is a first-class safety feature, not an afterthought.

**Integrated xterm terminal**
Multi-tab, split-pane terminal built into the UI. Keybindings for toggle/split/new/close. Configurable via `~/.t3/keybindings.json`.

Default keybindings:
```json
{ "key": "mod+j", "command": "terminal.toggle" },
{ "key": "mod+d", "command": "terminal.split", "when": "terminalFocus" },
{ "key": "mod+n", "command": "terminal.new", "when": "terminalFocus" },
{ "key": "mod+w", "command": "terminal.close", "when": "terminalFocus" },
{ "key": "mod+n", "command": "chat.new", "when": "!terminalFocus" },
{ "key": "mod+o", "command": "editor.openFavorite" }
```

When conditions support `terminalFocus`, `terminalOpen`, and boolean operators (`!`, `&&`, `||`).

**Git branch picker + worktrees (planned/designed)**
Right-click "+ New thread" opens a context menu: branch list with optional worktree creation per branch. Thread then runs agent with the worktree path as cwd. Full design spec exists in `.plans/git-integration-branch-picker-worktrees.md`.

**Image attachments**
Paste or attach images to prompts. Already shipped.

**Electron desktop app + distribution**
- macOS `.dmg` (arm64 and x64)
- Linux AppImage
- Windows NSIS installer
- `npx t3@alpha` for zero-install web mode
- Desktop app spawns backend on loopback with an auth token, loads UI via `t3://app/index.html`

**Remote access with auth token**
CLI flags: `--auth-token`, `--host`, `--port`, `--no-browser`. Documented Tailscale integration. Intended for phone/tablet access to a machine running on the LAN.

**Multi-instance dev isolation**
`T3CODE_DEV_INSTANCE=feature-xyz` deterministically shifts all dev ports together (server + web). Useful for running multiple feature branches simultaneously.

**Project script runner**
Keybinding command `script.{id}.run` (e.g. `script.test.run`) runs scripts from `package.json` within the UI. Bindable to any key.

**Open in editor**
`editor.openFavorite` command opens the current project/worktree in the last-used editor.

**External runners**
Run the CLI on a remote machine (e.g. a mac mini), connect browser from another device. Shipped.

**Inline diff visualization**
`@pierre/diffs` renders file diffs inline in the chat conversation.

**Tool call noise reduction**
Tool calls are collapsed into "boxes" with a limited number shown at a time. "Command run" and "command completed" events combined. Reduces visual noise significantly.

### Planned (in TODO.md)

- Plan mode
- Message queueing
- Thread archiving
- Only show last 10 threads per project (performance)
- New projects sorted by latest thread update

---

## Provider Architecture

WebSocket protocol uses simple JSON-RPC style:
- Request/response: `{ id, method, params }` → `{ id, result }` or `{ id, error }`
- Push events: `{ type: "push", channel, data }` for orchestration read-model updates

`NativeApi` interface methods:
- `providers.startSession`, `providers.sendTurn`, `providers.interruptTurn`
- `providers.respondToRequest`, `providers.stopSession`
- `shell.openInEditor`, `server.getConfig`
- `git.listBranches`, `git.createWorktree`, `git.removeWorktree` (planned)

Codex is the only implemented provider. Claude Code is reserved (`claudeCode`) in the contracts but unimplemented. The contracts layer is designed so adding a new provider is a matter of implementing the `NativeApi` interface.

---

## btca CLI Skill

Bundled with the repo under `.agents/skills/btca-cli/SKILL.md`. A CLI tool for querying external git repositories via natural language without bloating the agent's context window. It spawns a subagent to explore the codebase and returns only the answer.

```bash
btca ask -r codex -q "What is the return format for Codex App Server responses?"
btca add -n svelte-dev https://github.com/sveltejs/svelte.dev
btca resources
```

This is essentially what the Overdeck `Explore` subagent does manually — but as a first-class CLI skill the agent can invoke during work.

---

## Comparison to Overdeck

### What t3code has that Overdeck lacks

| Feature | t3code | Overdeck |
|---|---|---|
| Desktop app (Electron) | Yes — DMG, AppImage, installer | No |
| Zero-install (`npx t3@alpha`) | Yes | No |
| Supervised mode (per-action approval) | Yes — pause + approve/deny in UI | No |
| Integrated terminal (xterm) | Yes — tabs, splits, keybindings | Dashboard links to tmux, no in-UI terminal |
| Auth token on dashboard | Yes — `--auth-token` flag | No auth layer |
| Remote access (phone/tablet) | First-class, documented | Not supported |
| Thread/conversation history | Persisted per project | Ephemeral — no history after workspace close |
| Image attachments in prompts | Yes | No |
| Multi-provider abstraction layer | Yes — typed `NativeApi` contracts | Claude Code specific |
| Effect framework typed architecture | Yes — composable, strict error types | Ad-hoc Node.js + Socket.io |
| btca codebase query CLI | Yes | No equivalent |
| Multi-instance dev (port isolation) | Yes — hash-based port shifting | No |
| Git branch picker UI | Designed, in-progress | Programmatic only |
| Project script runner (keybindings) | Yes | No |
| Distributable releases / CI | Yes — GitHub Releases | No |

### What Overdeck has that t3code lacks

| Feature | Overdeck | t3code |
|---|---|---|
| Multi-agent orchestration | Yes — convoys, parallel agents | No — single agent per thread |
| Specialist pipeline | Yes — review → test → merge | No |
| Issue tracker integration | Yes — Linear, GitHub | No |
| PRD gating + planning workflow | Yes | No |
| Cloister (stuck detection, model routing) | Yes | Single model per session |
| Skills system | Yes — 60 universal SKILL.md skills | One btca skill |
| Docker-isolated workspaces | Yes | No isolation |
| Beads task tracking | Yes | No |
| Full automated issue-to-merge workflow | Yes | No |

### Summary

t3code is a polished single-agent chat UI solving the "I want a nice interface for Codex/Claude" problem. Overdeck is solving the "I want AI to autonomously work through issues end-to-end" problem. They overlap mainly in the dashboard/UI layer.

t3code's architecture is significantly more rigorous than Overdeck's in the contracts and type-safety dimension. Its Effect-based server is a stronger foundation than Overdeck's current Socket.io approach.

---

## Ideas Worth Borrowing

### High priority

**1. Supervised mode**
A per-action approval UI is a major trust and safety feature that enterprise users or cautious devs will want. In Overdeck this maps to: when an agent wants to run a destructive command (rm, force push, db migration), pause and surface an approval prompt in Mission Control. Codex's `approvalPolicy: on-request` is the right model. Implement as a new workspace state + Mission Control notification + approve/deny buttons.

**2. Auth token on dashboard**
`pan up --auth-token <token>` is trivial to add and unlocks remote access. Without it the dashboard is localhost-only. Overdeck workspaces already run on remote servers in some setups (exe.dev) — auth on the dashboard socket is a real gap.

**3. Thread/conversation history**
Workspaces close after merge and all conversation context is gone. Even just storing the final conversation log (JSON) associated with the issue would be useful for debugging and auditing. SQLite via Effect's `@effect/sql-sqlite-bun` is a clean model to follow.

### Medium priority

**4. Integrated terminal in dashboard**
Embedding xterm.js into Mission Control would let users interact with tmux sessions from the browser rather than a separate terminal window. t3code's implementation uses `node-pty` + xterm — both are well-supported.

**5. btca-style context-isolated codebase querying**
A `pan ask -r <project> -q "..."` skill that runs a subagent against a project and returns just the answer. Useful for plan agents that need to understand a codebase without bloating their context window with full file reads.

**6. Multi-instance dev isolation**
`PAN_DEV_INSTANCE=feature-xyz` that shifts dashboard + all service ports together. Useful for dogfooding Overdeck changes while it's also running in prod.

### Low priority / nice to have

**7. Image attachment support** — pass screenshots and diagrams to agents
**8. Project script runner keybindings** — `script.test.run` etc. in dashboard
**9. `npx panopticon@latest`** — zero-install mode for getting started

---

## References

- Repo: https://github.com/pingdotgg/t3code
- Codex App Server docs: https://developers.openai.com/codex/sdk/#app-server
- Reference implementation (Tauri, feature-complete): https://github.com/Dimillian/CodexMonitor
- Plans directory: `/home/eltmon/Projects/t3code/.plans/`
- Docs directory: `/home/eltmon/Projects/t3code/.docs/`
