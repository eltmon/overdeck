Here's the full picture.

**review_status / status_history** (SQLite tables):
- `mission-control.ts` — ActivityView renders history entries as sections
- `workspaces.ts` — merge queue, workspace status, PR URL lookup
- `agents.ts` — agent enrichment, agent list status
- `specialists.ts` — spawn/check status
- `read-model.ts` — dashboard read model
- `review-agent.ts` — maps parallel review results, drives status transitions (pending → reviewing → passed/blocked/failed)
- `deacon.ts` — stuck detection, force-kill decisions
- `verification-runner.ts` — verification gate checks
- `done.ts` (CLI) — `pan done` checks current status before proceeding
- `agent-enrichment-service.ts` — background polling
- `metrics.ts`, `reopen.ts`, `review-status-json.ts`

**heartbeats** (`~/.panopticon/heartbeats/<agentId>.json`):
- `claude-code.ts` (`getHeartbeat()`) — runtime reads its own hook-written JSON
- `deacon.ts` (`checkHeartbeat()`) — determines if a specialist is responsive vs stale
- `mission-control.ts` — ActivityView includes heartbeat age in agent status
- `health.ts` / `health-filtering.ts` — health pipeline
- `hooks.ts` (CLI setup) — the thing that *writes* them on PostToolUse

**tmux scrollback**:
Read **directly from tmux on demand**, never cached to disk. `capturePaneAsync()` in `src/lib/tmux.ts:487` runs `tmux capture-pane -t <session> -p -S -<lines>` via `tmuxExecAsync()` and returns the string.

Consumers of live scrollback:
- `mission-control.ts` — ActivityView transcript for running agents/reviews
- `conversations.ts` — conversation panel preview
- `agents.ts` — agent log streaming endpoint
- `workspaces.ts` — workspace terminal preview
- `ws-terminal.ts` — WebSocket terminal initial snapshot + live streaming
- `deacon.ts` — stuck detection (regex-parses last N lines for "thinking…" loops)
- `merge-agent.ts` — parses merge result markers from pane output
- `specialists.ts` — pre/post kill snapshots
- `agents.ts` (lib) — `getLatestAgentOutput()`, `getAgentTranscript()`
- `health.ts` / `health-filtering.ts` — health check output scraping
- `tmux.ts` itself — `sendKeysAsync` confirmation, message receipt parsing

So yes, you have **three overlapping persistence layers**: SQLite for structured state, heartbeat JSON files for runtime liveness, and tmux pane buffers for raw output. Nothing intermediates the tmux scrollback — every consumer shells out to `tmux capture-pane` independently.
