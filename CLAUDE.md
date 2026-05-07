# Panopticon CLI - Development Guidelines

## Engineering Philosophy: No Bandaids

**NEVER apply workarounds, hacks, or "just get it working" fixes.** Every issue, no matter how minor, must be addressed at its root cause as soon as it arises. If something is broken, find out WHY it's broken and fix the underlying problem — don't paper over symptoms with fallback chains or special-case handling.

This means:
- Investigate before fixing. Understand the full causal chain.
- If a fix requires understanding code you haven't read, read it first.
- If a component is generating bad data, fix the component — don't add defensive code downstream to tolerate bad data.
- If an agent is misbehaving, fix the agent's constraints — don't add monitoring to catch the misbehavior after the fact.

## CRITICAL: Never Work Around Broken Things — Fix Them

**When something is broken, FIX IT. Never manually do what the code should do, never dismiss errors as "transient", never bypass a broken tool by using an alternative.**

This means:
- If a test should verify behavior, don't manually verify it — fix the test and run it.
- If an API endpoint should create beads, don't run `bd init` manually — fix the endpoint.
- If Playwright MCP crashes, don't fall back to `curl` — investigate why it crashed and fix it.
- If a label should be removed by the merge flow, don't run `gh issue edit` — fix the merge flow.
- If the dashboard should show the right status, don't tell the user to refresh — fix the data pipeline.

**Every workaround is a bug you chose not to fix.** The user has stated this hundreds of times: always pick up the trash, never walk over it, zero intentional technical debt. This applies to EVERYTHING — tools, tests, data, UI, infrastructure. No exceptions.

## CRITICAL: Never Do Agent Work — Fix the System

**When an agent produces bad results (incomplete work, wrong output, passing with known issues), NEVER fix the output yourself. Fix the Panopticon system that allowed the bad result.**

This means:
- Review agent passes with known issues → Fix the review agent prompt or acceptance criteria so it BLOCKS instead of passing
- Work agent leaves dead code or uncommitted changes → Fix the verification gate or done flow to catch it
- Merge agent fails silently → Fix the failure reporting in the pipeline
- NEVER edit workspace files to fix what an agent should have done
- NEVER manually run commands that a pipeline flow should handle
- ALWAYS ask "why did the system allow this?" before touching any code

The goal is autonomous correctness. Every manual intervention is a system bug.

## CRITICAL: Deliver Complete Features — No Partial Implementations

**Unless explicitly asked to break work into phases, deliver the entire feature in a single issue.** A feature is idempotent — partial delivery provides zero value to the end user.

- A PRD may describe phases for organizational clarity, but the agent MUST implement ALL phases before calling `pan done`.
- Do not merge a subset of a feature and call it done. If the issue says "redesign the kanban board", that means ALL aspects of the redesign — not just the easy parts.
- "Large refactor" is not an excuse to ship incomplete work. The size of the change is the size of the change.
- If a feature genuinely cannot be completed in one session (e.g., token limits), the agent should document exactly what remains and NOT signal completion. The issue stays open until ALL work is done.
- PRD phases are implementation guidance, not separate deliverables.

## CRITICAL: JSONL Session Files Are Sacred — NEVER Delete

**NEVER delete, overwrite, or truncate Claude Code JSONL session files** (`~/.claude/projects/*/*.jsonl`). These files are the only record of conversation history — they contain the user's work, context, and decisions. Losing them is irreversible data loss.

**Rules:**
- **NEVER delete a JSONL file** unless the user explicitly asks AND you have confirmed with them a second time ("Are you sure? This cannot be undone.")
- **NEVER delete JSONL files as part of cleanup operations** — cleaning up orphaned conversations means removing DB records and killing tmux sessions, NOT touching JSONL files
- **NEVER assume a JSONL file is "garbage"** based on size — even small files may represent conversations the user is actively working with
- Code that programmatically deletes JSONL files (e.g., `fs.unlinkSync` on a session path) must NEVER be written without explicit user instruction
- When cleaning up failed forks or orphaned conversations, leave the JSONL files intact

## Commit and Push When Working on Main

When working directly on `main` (not in a Panopticon workspace), commit completed changes and push to `origin` before ending the session. Agent PRs merge to `origin/main` through the pipeline — unpushed local commits cause divergence that requires manual merge resolution. Don't commit half-done work; finish the change, verify it builds, then commit and push.

## CRITICAL: No Blocking Calls in Dashboard Server Code

**NEVER use `execSync`, `readFileSync`, `writeFileSync`, `readdirSync`, or `statSync` in any code reachable from the dashboard server** (Effect route handlers in `src/dashboard/server/routes/`, services in `src/dashboard/server/services/`, or any module imported by them).

These block the Node.js event loop, freezing all HTTP requests, WebSocket connections, and terminal streaming. This was a major issue tracked in PAN-70 (15 commits to fix execSync) and PAN-446 (139 sync FS calls still in routes).

**Rules:**
- Dashboard server code: use `execAsync` (promisified `exec`), `fs/promises`, or Effect `FileSystem` service
- `existsSync` is acceptable (fast stat check, no data read)
- tmux message delivery: use `sendKeysAsync()` from `src/lib/tmux.ts`
- CLI commands only: sync calls are acceptable since they run in their own process
- `sleep` via `execSync('sleep 0.3')` is NEVER acceptable in server code — use `await new Promise(r => setTimeout(r, 300))`

## Project Structure

- **Stack**: TypeScript, Node.js 22+, React dashboard, SQLite, Effect.js
- **Build**: `npm run build` (tsdown for CLI/server/contracts, Vite for frontend)
- **Dev**: `npm run dev` (tsx watch)
- **Dashboard**: Must use Node 22 (built dist) — `nohup /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js`
  - **NEVER use `bun run src/dashboard/server/main.ts`** — two reasons:
    1. **node-pty** (`@homebridge/node-pty-prebuilt-multiarch`) is a native Node addon. Under Bun's addon compat layer the PTY spawns but exits with code 0 immediately, breaking `/ws/terminal` for all workspaces.
    2. **Circular ESM deps** — the dashboard source has circular imports that Bun tolerates but Node.js strict ESM rejects, so tsx/source-mode also fails under Node.
  - `pan up` handles this automatically — it runs `dist/dashboard/server.js` under Node 22. Run `npm run build` first if the dist is stale.
- **Issue tracking**: GitHub Issues (PAN-XXX prefix), NOT Linear
- **Package manager**: Bun (bun.lock, `bun install`, `bun add`)
- **Workspaces**: Bun workspaces — `packages/contracts`, `src/dashboard/server`, `src/dashboard/frontend`
- **Build configs**: tsdown.config.ts (root for CLI, src/dashboard/server/ for server, packages/contracts/ for contracts, scripts/ for cost script)

## Workspace Setup for Agents

Workspaces are git worktrees at `workspaces/feature-<issue-id>/`. Each worktree has its
own `node_modules` created by `bun install` — **never symlink node_modules from the main repo**.
Symlinks break local workspace package resolution (e.g., `@panctl/contracts` would
resolve to the main repo's stale build instead of the worktree's version).

**Before running builds or tests in a workspace:**
1. Run `bun install` from the workspace root (creates correct workspace-aware node_modules)
2. If you modified `packages/contracts/`, rebuild: `cd packages/contracts && npm run build`
3. Build commands use the root `node_modules/.bin/` — run from workspace root, not subdirectories

**NEVER symlink node_modules** — `bun install` uses hardlinks from the global cache and is
nearly instant (~2s). It correctly resolves `@panctl/contracts` to the worktree's local
`packages/contracts/` via Bun workspace resolution.

**Quality gates** (must pass before `pan done`):
- `npm run typecheck` — TypeScript strict mode
- `npm run lint` — ESLint
- `npm test` — Vitest (root + frontend)

## tmux Socket — CRITICAL

**Panopticon agents run under a separate tmux socket named `panopticon`.** Always use `-L panopticon` when inspecting agent sessions:

```bash
# List all agent sessions
tmux -L panopticon list-sessions

# Attach or capture a specific agent
tmux -L panopticon capture-pane -t agent-min-846 -p -S -50
tmux -L panopticon attach -t agent-min-846
```

The default tmux socket (`/tmp/tmux-1000/default`) is NOT used by agents. Plain `tmux list-sessions` will show "no server running" or list unrelated sessions. This is a common source of false "agent not found" errors.

## tmux Message Delivery

Use `load-buffer` + `paste-buffer` pattern (NOT raw `send-keys` for text):
```typescript
// Correct (in sendKeysAsync):
writeFileSync(tmpFile, keys);
await execAsync(`tmux load-buffer ${tmpFile}`);
await execAsync(`tmux paste-buffer -t ${session}`);
await new Promise(r => setTimeout(r, 300));  // Let text render
await execAsync(`tmux send-keys -t ${session} C-m`);  // Enter
```

Raw `tmux send-keys "text"` followed immediately by `C-m` is unreliable — Enter arrives before text is processed.

## Claude Code Channels (experimental)

Reference: https://code.claude.com/docs/en/channels

Claude Code Channels is a research-preview MCP capability that delivers
orchestrator-to-agent messages over a stdio JSON-RPC transport instead of
tmux send-keys. It exists because tmux paste-buffer delivery has a long
tail of failure modes (paste before render, dropped Enter, partial text)
that surface as silently-unanswered prompts; Channels removes the timing
race entirely.

The integration in this repo is **opt-in and off by default**, gated
behind a single experimental flag in the dashboard Settings page
(`experimental.claudeCodeChannels`). Eligibility is narrow on purpose:
the path engages only for **work agents** running the **Claude Code**
runtime with **Anthropic auth** (claude.ai OAuth or Console API key) on
**non-Docker workspaces**. Codex, Cursor, Gemini, Cliproxy-routed-GPT,
Bedrock, Vertex, Foundry, and Docker workspaces all stay on tmux send-keys
unconditionally.

**Architecture:**

- `src/lib/channels/panopticon-bridge.ts` — per-agent Bun stdio MCP server.
  Spawned by `claude --dangerously-load-development-channels server:panopticon-bridge`
  using a workspace-local `.pan/agent-mcp.json`. Listens on
  `${PANOPTICON_HOME}/sockets/agent-<id>.sock` (mode 0o600), accepts POSTs
  of `{ content, meta? }`, and forwards each as a
  `notifications/claude/channel` MCP frame.
- `deliverAgentMessage(agentId, message, caller?)` in `src/lib/agents.ts`
  is the **single delivery primitive** — eligibility check, socket POST
  with 2s timeout, automatic tmux fallback on any failure mode (state
  missing, socket missing, ENOENT, ECONNREFUSED, EPIPE, non-2xx, write
  timeout). Callers stay caller-agnostic; the primitive owns the policy.
- The dev-channels confirmation TUI dialog (`WARNING: Loading development
  channels`) is dismissed automatically at agent startup via one
  `sendRawKeystrokeAsync(C-m)` call, gated on `state.channelsEnabled`.

**Scope:** only the work-agent prompt-delivery sites in `src/lib/agents.ts`
migrate. The following intentionally stay on `sendKeysAsync`:
`src/lib/cloister/` (specialists, deacon, review, merge), `src/lib/runtimes/`
(non-Claude-Code runtimes), `src/dashboard/server/routes/conversations.ts`,
and `src/dashboard/server/routes/misc.ts`. Bidirectional reply tools and
dashboard-routed permission relay are out of scope and tracked as separate
follow-up issues.

## Dashboard Server Architecture (Effect + Raw WebSocket)

The dashboard server uses **Effect.js** for HTTP routes and structured RPC, plus a
**raw WebSocket** endpoint for terminal streaming.

**Server structure** (split from old 15K-line monolith in PAN-428):
- `src/dashboard/server/main.ts` — entry point, dual-runtime (Bun dev, Node prod)
- `src/dashboard/server/server.ts` — Effect HTTP server, route composition, layers
- `src/dashboard/server/ws-rpc.ts` — Effect RPC over WebSocket at `/ws/rpc`
- `src/dashboard/server/ws-terminal.ts` — raw WebSocket terminal at `/ws/terminal`
- `src/dashboard/server/routes/*.ts` — 12 route modules (issues, agents, workspaces, etc.)
- `src/dashboard/server/services/*.ts` — domain services (event store, read model, cache, enrichment, etc.)
- `src/dashboard/server/read-model.ts` — in-memory read model, bootstrapped from lib modules

**Two WebSocket endpoints:**
- `/ws/rpc` — Effect RPC (PanRpcGroup): domain events, snapshots, replay. Uses typed Schema.
- `/ws/terminal?session=<name>` — Raw WebSocket: live PTY terminal streaming via `ws` library.
  Terminal data bypasses Effect RPC because the RPC serialization layer can't handle
  high-throughput binary-like terminal data reliably.

**Terminal architecture** (`ws-terminal.ts` + `XTerminal.tsx`):
- Server: raw `WebSocketServer` with `noServer: true`, deferred PTY spawn (waits for
  client resize dimensions), `node-pty` spawns `tmux attach-session`
- Client: raw `WebSocket` API with exponential backoff reconnection
- PTY waits for tmux session to exist (`waitForTmuxSession`) before spawning
- Data flows immediately on attach — no stale data suppression
- Dimension toggle at 200ms forces correct-size repaint

**Frontend data flow:**
- `EventRouter.tsx` → connects to `/ws/rpc`, fetches snapshot via `getSnapshot` RPC,
  subscribes to `subscribeDomainEvents` stream, applies events to Zustand store
- `WsTransport.ts` — Effect-based RPC client with auto-reconnection
- Store: Zustand with shared reducers from `@panctl/contracts`

**Session lifecycle rules:**
- On WebSocket close, do NOT kill the PTY — the tmux session survives independently.
- Do NOT pre-resize tmux windows. Let the PTY spawn handle sizing via client dimensions.
- The planning launcher script MUST export TERM/COLORTERM/LANG for Claude Code rendering.
- Planning sessions use `remain-on-exit on` + `destroy-unattached off` so the session
  survives after the agent exits, until the user clicks Done.

## Verification Gate (PAN-174)

After a work agent signals completion, Cloister runs quality gates from `projects.yaml`
before waking the review-agent. If typecheck/lint/test fail, feedback is sent to the
agent's tmux session and the completion marker is NOT processed (allowing retry).
After 3 consecutive failures, verification is bypassed to prevent permanent blocking.

## Project Resolution from Issue IDs

Issue IDs are resolved to projects via `resolveProjectFromIssue()` in `src/lib/projects.ts`
and `parseGitHubRepos()` in `src/lib/tracker-utils.ts`. Resolution order:

1. Match `linear_team` field in `projects.yaml` (e.g., `linear_team: MIN` matches `MIN-123`)
2. For GitHub-only projects without `linear_team`, derive prefix from the project key
   (e.g., project key `krux` → prefix `KRUX` matches `KRUX-3`)

When adding a new project to `projects.yaml`, either set `linear_team` explicitly or
ensure the project key (uppercased, hyphens removed) matches the issue prefix you want.

## Beads Enforcement

Work agents cannot start without beads tasks in the workspace. The start-agent endpoint
returns 422 if `.beads/issues.jsonl` does not exist. Planning must create beads via
`bd create` before handing off to implementation.

## Stash Hygiene

Stashes are git refs — they persist until explicitly dropped. Left alone, they accumulate fast (we cleared out 106 stashes during the 1.0 stabilization audit on 2026-04-23). The goal is to keep the list short enough that it stays meaningful.

**Naming rules (when Panopticon code creates a stash):**
- Start with a category prefix so stashes are greppable:
  - `pre-merge:PAN-XXX:<iso-timestamp>` — safety snapshot before a merge operation
  - `pre-spawn:PAN-XXX:<iso-timestamp>` — planning-debris snapshot before an agent start
  - `review-temp:PAN-XXX:<n>` — short-lived stash during a review-request roundtrip
  - `salvageable:PAN-XXX:<iso-timestamp>:<short-description>` — explicitly flagged as user work that may need recovery (e.g. uncommitted edits discovered during cleanup)

**Drop-on-completion rules:**
- `pre-merge:*` — drop once the merge succeeds (or the merge flow rolls back).
- `pre-spawn:*` — drop once the agent has checkpointed its first real commit.
- `review-temp:*` — drop when the review request completes (success OR failure).
- `salvageable:*` — NEVER drop automatically. These must be either recovered to a branch or reviewed by the user.

**Triage cadence:**
- Any stash older than 4 weeks that is NOT `salvageable:*` is a candidate for cleanup.
- Any `salvageable:*` stash surfaces in the dashboard's workspace inspector so the user can see it and decide.

**Recovery:**
- `git stash drop` preserves the stash commit in the reflog for 90 days. Anything dropped accidentally is recoverable during that window.

## CRITICAL: postMergeLifecycle Idempotency

`onMergeComplete()` and `/api/specialists/done` have idempotency guards to prevent
infinite loops. NEVER remove these guards. The loop: specialists/done → onMergeComplete
→ postMergeLifecycle → (re-trigger) → specialists/done burned 24,626 Linear API calls
before guards were added (PAN-328).

## postMergeLifecycle Docker Cleanup

`postMergeLifecycle()` in `merge-agent.ts` stops Docker containers and networks after
merge (step 6). This prevents Docker network pool exhaustion — orphaned networks from
merged workspaces accumulate and eventually block new workspace creation with
"all predefined address pools have been fully subnetted". Docker's default pool only
supports ~31 bridge networks. NEVER remove this cleanup step.

## CRITICAL: Deep-Wipe Destroys Everything — NEVER Run Without Explicit User Confirmation

The deep-wipe endpoint (`POST /api/agents/:id/deep-wipe`) with `deleteWorkspace: true` is **irreversible** and destroys:

1. **tmux sessions** — all agent sessions killed
2. **Agent state directories** — `~/.panopticon/agents/<id>/` removed
3. **Entire workspace directory** — this includes:
   - `.pan/spec.vbrief.json` — the **workspace-specific vBRIEF plan**
   - `.beads/` — all task tracking beads
   - Any implementation work in progress
4. **Git branches** — both local AND remote `feature/<issue-id>` branches deleted
5. **Linear/GitHub status** — issue status reset to Todo/Open

**The scope vBRIEF** in `.pan/specs/` on main survives deep-wipe — it's committed to the project repo independently of the workspace. The docs-level PRD (e.g., `myn/docs/prds/planned/MIN-XXX-*.md`) also survives. The workspace `.pan/` directory (spec, continue state) and `.beads/` are destroyed.

**Rules:**
- **NEVER call deep-wipe programmatically** without the user explicitly requesting it
- **NEVER attempt destructive HTTP requests** (POST, DELETE) speculatively — HTTP requests execute immediately when sent; tool rejection by the user CANNOT stop an already-sent request
- When a user wants to restart an agent, use the regular stop/restart flow, NOT deep-wipe
- Deep-wipe is a last resort for cleaning up abandoned workspaces, not a routine operation

## TLDR: Token-Efficient Code Analysis

**If your workspace has a `.venv` directory, you have access to TLDR tools for code analysis.**

TLDR provides structured code summaries using 500-1,200 tokens per file instead of 10-25k, extending how much work you can accomplish per session.

### Available MCP Tools

When TLDR is available, you'll have these MCP tools:
- `tldr_context <file>` - File structure, exports, imports, key functions
- `tldr_structure <directory>` - Directory layout and relationships
- `tldr_calls <function> <file>` - Call graph (what calls this function)
- `tldr_impact <function> <file>` - Impact analysis (what this function calls)
- `tldr_semantic <query>` - Natural language code search

### Recommended Workflow

1. **Explore with TLDR first:**
   - Use `tldr_context` to understand file structure before reading
   - Use `tldr_semantic` to find relevant code by description
   - Use `tldr_calls` and `tldr_impact` for dependency analysis

2. **Read full files only when editing:**
   - TLDR shows you the structure and what to edit
   - Read the full file to get exact line numbers and implementation
   - Edit the specific sections you identified

3. **Avoid reading everything:**
   - 20 files × 15k tokens = 300k tokens (exhausts context)
   - 20 files × 800 tokens (TLDR) = 16k tokens (94% savings)

**Use TLDR liberally to maximize your session effectiveness.**

## vBRIEF Plans & Lifecycle

Panopticon uses **vBRIEF v0.5** for machine-readable work plans with a filesystem-as-state lifecycle model. Key references:

- **Canonical spec:** [github.com/deftai/vBRIEF](https://github.com/deftai/vBRIEF)
- **Our fork:** [github.com/eltmon/vBRIEF](https://github.com/eltmon/vBRIEF)
- **Extension proposal:** [deftai/vBRIEF#1](https://github.com/deftai/vBRIEF/issues/1)
- **Panopticon docs:** [docs/VBRIEF.md](docs/VBRIEF.md)

### Lifecycle Directories

Scope vBRIEFs live in `vbrief/` at the project root and move between directories as work progresses:

- `vbrief/proposed/` — planning complete, awaiting approval
- `vbrief/active/` — agent is working on it
- `vbrief/completed/` — merged/closed
- `vbrief/cancelled/` — abandoned

Filenames are issue-keyed: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`

### Continue State

`continue-<issueId>.vbrief.json` replaces STATE.md as the structured session history. Lives alongside the scope vBRIEF in the same lifecycle directory. Contains git state, decisions, hazards, resume point, beads mapping, agent model, and session history.

### Auto-Behaviors

- `io.ts` (`updateItemStatus`/`updateSubItemStatus`) auto-increments `plan.sequence` and sets `updated` timestamps on every write
- `complete-planning` promotes vBRIEF to `vbrief/proposed/` on main with an issue-keyed filename
- `start-agent` transitions vBRIEF from `proposed/` to `active/` and sets `plan.status` to `approved`/`running`
- `postMergeLifecycle` transitions vBRIEF from `active/` to `completed/` on main
- `start-planning` discovers PRDs from `docs/prds/planned/` and `docs/prds/active/` matching the issue ID and copies to `.pan/prd.md`
- `findPlan()` resolves vBRIEFs from `.pan/specs/` on main first, falling back to workspace `.pan/spec.vbrief.json`

### Dashboard Viewer

VBriefViewer components at `src/dashboard/frontend/src/components/vbrief/`:
- Accessible via **vBRIEF button** on kanban issue cards and InspectorPanel
- List / DAG / Raw JSON tabs
- Fetches from `GET /api/workspaces/:issueId/plan` (resolves from lifecycle dirs first, then workspace)

## Issue Creation from PRDs

When creating a Linear or GitHub issue from a PRD, **always reference the PRD at the very top of the issue description** -- before any other content. Use a bold label with a repo-relative path and a clickable link:

```
**PRD:** [`path/to/prd.md`](https link to the file in the repo)
```

The issue body should then contain a tight summary (vision, motivation, design goals, key capabilities, phases) -- NOT a full copy of the PRD. The PRD is the source of truth for data models, architecture, code samples, and implementation details. Duplicating that content into the issue creates drift.
