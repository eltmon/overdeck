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

## CRITICAL: Deliver Complete Features — No Partial Implementations

**Unless explicitly asked to break work into phases, deliver the entire feature in a single issue.** A feature is idempotent — partial delivery provides zero value to the end user.

- A PRD may describe phases for organizational clarity, but the agent MUST implement ALL phases before calling `pan work done`.
- Do not merge a subset of a feature and call it done. If the issue says "redesign the kanban board", that means ALL aspects of the redesign — not just the easy parts.
- "Large refactor" is not an excuse to ship incomplete work. The size of the change is the size of the change.
- If a feature genuinely cannot be completed in one session (e.g., token limits), the agent should document exactly what remains and NOT signal completion. The issue stays open until ALL work is done.
- PRD phases are implementation guidance, not separate deliverables.

## CRITICAL: No execSync in Dashboard Server Code

**NEVER use `execSync` in any code reachable from the dashboard server** (Express routes, Socket.io handlers, Cloister specialists, deacon, or any module imported by `src/dashboard/server/index.ts`).

`execSync` blocks the Node.js event loop, freezing all HTTP requests, WebSocket connections, and polling. This was a major issue tracked in PAN-70 (15 commits to fix).

**Rules:**
- Dashboard server code: use `execAsync` (promisified `exec`) or `spawn` with async handling
- tmux message delivery: use `sendKeysAsync()` from `src/lib/tmux.ts`
- CLI commands only: `execSync` and sync `sendKeys()` are acceptable since they run in their own process
- `sleep` via `execSync('sleep 0.3')` is NEVER acceptable in server code — use `await new Promise(r => setTimeout(r, 300))`

**Files that import from tmux.ts in server context MUST use `sendKeysAsync`, not `sendKeys`:**
- `src/dashboard/server/index.ts`
- `src/lib/agents.ts`
- `src/lib/cloister/merge-agent.ts`
- `src/lib/cloister/specialists.ts`
- `src/lib/runtimes/claude-code.ts`

## Project Structure

- **Stack**: TypeScript, Node.js 22+, React dashboard, SQLite, Effect.js
- **Build**: `npm run build` (tsdown for CLI/server/contracts, Vite for frontend)
- **Dev**: `npm run dev` (tsx watch)
- **Dashboard**: Must use Node 22 — `node dist/dashboard/server.js` from repo root
- **Issue tracking**: GitHub Issues (PAN-XXX prefix), NOT Linear

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

## Dashboard Terminal Architecture (Effect RPC)

The dashboard shows live terminal output via Effect RPC over a single WebSocket at `/ws/rpc`.

All terminal methods are part of `PanRpcGroup` (defined in `@panopticon/contracts`):
- `subscribeTerminal(sessionName, cols, rows)` → `Stream<TerminalOutput>` — live PTY data
- `terminalWrite(sessionName, data)` — send keyboard input
- `terminalResize(sessionName, cols, rows)` — resize the PTY
- `terminalClose(sessionName)` — close the session

**Server side**: `TerminalService` (`src/dashboard/server/services/terminal-service.ts`)
manages PTY lifecycle. Uses `node-pty` on Node, `Bun.spawn()` on Bun. Implements deferred
PTY spawn — the PTY is not started until `subscribeTerminal` provides initial dimensions.

**Client side**: `XTerminal.tsx` uses `WsTransport.subscribe()` for the data stream and
`WsTransport.request()` for write/resize/close. Auto-reconnection is built into the
transport layer — no manual WebSocket management needed.

**Stale data suppression**: When the PTY attaches, tmux sends content rendered at the
OLD size (80×24 default). This burst is suppressed for ~200ms, then a dimension toggle
forces SIGWINCHs to guarantee a full repaint at the correct size.

**Session lifecycle rules:**
- On subscription end, do NOT kill the PTY — the tmux session survives independently.
- Do NOT pre-resize tmux windows to arbitrary large sizes. Let the PTY spawn handle
  sizing via the client's actual dimensions from `subscribeTerminal`.
- The local planning launcher script MUST export TERM/COLORTERM/LANG for proper
  Claude Code rendering.

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
   - `.planning/STATE.md` — planning progress and status
   - `.planning/plan.vbrief.json` — the **workspace-specific vBRIEF plan** with items, acceptance criteria, and dependencies (generated during planning)
   - `.planning/beads/` — all task tracking beads
   - Any implementation work in progress
4. **Git branches** — both local AND remote `feature/<issue-id>` branches deleted
5. **Linear/GitHub status** — issue status reset to Todo/Open

**The docs-level PRD** (e.g., `myn/docs/prds/planned/MIN-XXX-*.md`) survives because it's committed to the docs repo, but it is NOT the same as the workspace vBRIEF plan generated during planning. The two workspace planning artifacts are `plan.vbrief.json` (structured plan with acceptance criteria) and `STATE.md` (narrative context and current status).

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
