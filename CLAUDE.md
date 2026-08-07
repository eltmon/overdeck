# Overdeck CLI - Development Guidelines

> **Note:** Universal and dev-scope engineering rules — async tmux, no execSync in server, fake timers for retry tests, worktree discipline, work-agents-via-pan, stash discipline, dashboard-Node22-only, single-deacon invariant, no-destructive-requests, file-path references, Karpathy rules — live in [`sync-sources/rules/`](sync-sources/rules/) and are folded into `~/.claude/CLAUDE.md` automatically via `pan sync`. This file holds **project-specific** guidance that doesn't apply outside this repo.

> **Knowledge bundle (OKF):** Project knowledge lives in the OKF bundle at [`../overdeck-knowledge`](../overdeck-knowledge) (remote `eltmon/overdeck-knowledge`), pointed to by [`.okf.yml`](.okf.yml). Use `/okf extract "<query>"` to pull cited context and `/okf author`/`/okf sync`/`/okf study` to maintain it. `/okf open` and the dashboard **Knowledge** page run OpenKnowledge against a disposable read-only snapshot; edit through `/okf author` because the upstream v0.34 editor does not preserve YAML source formatting losslessly.

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
- If an API endpoint should create tasks, don't run `bd init` manually — fix the endpoint.
- If Playwright MCP crashes, don't fall back to `curl` — investigate why it crashed and fix it.
- If a label should be removed by the merge flow, don't run `gh issue edit` — fix the merge flow.
- If the dashboard should show the right status, don't tell the user to refresh — fix the data pipeline.

**Every workaround is a bug you chose not to fix.** The user has stated this hundreds of times: always pick up the trash, never walk over it, zero intentional technical debt. This applies to EVERYTHING — tools, tests, data, UI, infrastructure. No exceptions.

## CRITICAL: Never Do Agent Work — Fix the System

**When an agent produces bad results (incomplete work, wrong output, passing with known issues), NEVER fix the output yourself. Fix the Overdeck system that allowed the bad result.**

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

When working directly on `main` (not in a Overdeck workspace), commit completed changes and push to `origin` before ending the session. Agent PRs merge to `origin/main` through the pipeline — unpushed local commits cause divergence that requires manual merge resolution. Don't commit half-done work; finish the change, verify it builds, then commit and push.

Permanent pipeline state is the exception to the code-branch destination: its
domain writers commit and push to the dedicated `overdeck-state` worktree at
`${OVERDECK_HOME}/state/<project>/`. Run `bd` against that worktree; do not
assume `.beads/` exists at the code-repository root. Never stage state paths on
`main` or a feature branch after a project is migrated.

## CRITICAL: Releases Go Through `pan release stable` — Never Manual

**To cut a new release of `@overdeck/*`, ALWAYS use `pan release stable --version X.Y.Z`. NEVER run `git tag v...` manually, never edit `"version"` in any `package.json` directly, never `npm version` or `npm publish`.**

The release tooling does five things atomically that humans (and agents) get wrong piecemeal:

1. Bumps `package.json`, `apps/desktop/package.json`, `packages/contracts/package.json` together (mismatches silently break the npm publish).
2. Generates rich release notes from `git log <prev-tag>..HEAD` into `.release/<tag>.md`.
3. Commits everything with the canonical subject `chore: release X.Y.Z`.
4. Creates an annotated tag.
5. Lets the CI release pipeline publish to npm via OIDC and create the GitHub Release with attached desktop binaries.

**How to release:**

```bash
# From a clean main, after the change you want to ship is committed
pan release stable --version 0.9.4
git push origin main
git push origin v0.9.4
```

**Guards already in place** (if you bypass them, you're working against the system):

- `.husky/pre-push` rejects release-shaped tags (`vX.Y.Z`, `vX.Y.Z-canary.N`) pushed to the overdeck repo whose commit doesn't have matching `package.json` versions and a committed `.release/<tag>.md`. Non-release tags (e.g. `v1-archive`) and non-overdeck remotes are skipped.
- `.github/workflows/release.yml` re-runs the same check on the runner side; tags missing the artifacts cause the release pipeline to fail loudly before any publish.
- `.husky/commit-msg` rejects commits that change a `package.json` version field unless the subject is `chore: release X.Y.Z` or `chore: bump version to X.Y.Z` (merge commits and newly-added package.json files are exempt). This catches the failure one step earlier than the push hook.

**If asked to "release", "tag", "bump version", "publish", or anything similar:** the answer is `pan release stable --version X.Y.Z`. Never a workaround, never a manual tag, never `--no-verify`.

## Harnesses

Overdeck supports five coding-agent harnesses: `claude-code` (default), `pi`/`ohmypi` (alternative, multi-provider), `codex` (OpenAI Codex CLI — first-party agent loop for the GPT model family), `acp` (native Agent Client Protocol, with Kimi Code CLI as the first wired agent), and `kimi-code` (Moonshot's own Kimi Code CLI, driven natively — no ACP host, Kimi models only). Codex work agents use the persistent `codex app-server` transport by default, with `codex.transport: tui` as a temporary escape hatch to the legacy `codexMode: work-tui` path; the runtime adapter remains `src/lib/runtimes/codex.ts`. The ACP integration vendors the Effect-based protocol client in `packages/effect-acp/` and runs through `src/lib/runtimes/acp.ts`. `kimi-code`'s runtime adapter is `src/lib/runtimes/kimi-code.ts`; it coexists with `acp` rather than replacing it — both drive the same `kimi` binary through different surfaces. The harness is picked per spawn at plan kickoff, role runs, work agent start, and the conversation panel; roles read harness/model defaults from Settings. Ohmypi + Anthropic + subscription auth is the only ToS-blocked combination (gate in `src/lib/harness-policy.ts`, keyed on `ohmypi` — the legacy `pi` name is normalized to `ohmypi` at settings load and is no longer a RuntimeName); the same gate blocks `kimi-code` for any non-Kimi model, since kimi-code runs Kimi models only.

See [configuration/harnesses.mdx](configuration/harnesses.mdx) for installation, picker locations, ToS rules, and troubleshooting. The wider field of coding-agent harnesses Overdeck could adopt is surveyed in [reference/harness-landscape.mdx](reference/harness-landscape.mdx). (`docs/HARNESSES.md` is now a redirect stub — the harness docs are published in the Mintlify site.)

## Telemetry

The anonymous event schema, privacy contract, and opt-out controls are documented in [docs/TELEMETRY.md](docs/TELEMETRY.md). Browser events must use `src/dashboard/frontend/src/lib/telemetry.ts`, and Node events, exceptions, and feature flags must use `src/lib/telemetry/service.ts`; never import a PostHog SDK or send to PostHog outside those write doors.

## Overdeck Agent Taxonomy

Overdeck's issue pipeline is expressed as four spawned **roles** plus a server-side merge handoff:

| Role | Purpose | Instruction source |
| --- | --- | --- |
| `plan` | Discover requirements and produce xBRIEF/tasks artifacts | `roles/plan.md` |
| `work` | Implement one task at a time in the workspace | `roles/work.md` |
| `review` | Synthesize code review and transition approved/blocked work | `roles/review.md` |
| `test` | Run automated verification and required browser UAT | `roles/test.md` |

Shipping is server-side: `rebaseFeatureBranch()` prepares branches and PAN-1650's review-status gate derives `readyForMerge`; no `roles/ship.md` file exists and no ship agent is spawned. The `ship` token survives only as the merge-specialist identity for model routing, historical activity attribution, and old session records.

Sub-roles are configuration slots under a role, not standalone pipeline stages. All sub-roles today are delivered as **harness-agnostic prompt templates** that the orchestrator inlines into spawn messages:

- **`review.security` / `review.correctness` / `review.performance` / `review.requirements`** — Overdeck reads `roles/review-<subRole>.md` and inlines the body into each convoy spawn message. Never loaded via Claude's `--agent` flag, never synced into project workspaces.
- **`work.inspect` / `work.inspect-deep`** — same shape: the inspection prompt is workflow-injected, not auto-discovered.

`.claude/agents/` is empty **at the repo root** (gitignored), but it is NOT unused: `pan sync` distributes the 11 ambient subagent definitions from `sync-sources/agents/` into every worktree's `.claude/agents/` (`src/lib/skills-merge.ts`), and Cloister depends on the pipeline agents existing there by name — `claude --agent pan-review-agent` etc. exits immediately without them (`REQUIRED_PIPELINE_AGENTS` in `src/lib/sync.ts`). Beware: three of the shipped definitions (`codebase-explorer`, `triage-agent`, `health-monitor`) hardcode `model: haiku`, which breaks on non-Anthropic-routed agents (CLIProxy → GPT models) because the harness doesn't always thread provider routing through to the subagent call. For ad-hoc codebase exploration prefer Claude Code's built-in subagent types (`Explore`, `general-purpose`), which inherit the parent's model and routing context properly.

`.claude/skills/` is also a workspace sync target, not a source of truth — same gitignore policy (PAN-1090).

The full mental model — Role vs Claude subagent vs Overdeck pipeline agent — lives in [docs/ROLES.md](docs/ROLES.md). For review specifically, see [docs/REVIEW-AGENT-ARCHITECTURE.md](docs/REVIEW-AGENT-ARCHITECTURE.md).

Legacy specialist wake/session/queue machinery has been removed. Use `spawnRun(issueId, role, opts)` and lifecycle state transitions instead of waking named specialists.

## Skills ↔ CLI Convention

The `pan` binary's subcommands and Claude Code's `pan-*` skills follow a strict convention:

- **`pan <verb>`** (CLI subcommand) is wrapped by **`/pan-<verb>`** (a skill at `sync-sources/skills/pan-<verb>/SKILL.md`).
- The `pan-` prefix is also a namespace for workflow / reference / topical skills (`/pan-code-review`, `/pan-network`) that don't map 1:1 to a single verb.
- Not every CLI verb gets a wrapper skill — only verbs where the skill adds non-trivial guidance beyond `--help`. The current exclusion list and the criteria are documented in [docs/SKILLS-CONVENTION.md](docs/SKILLS-CONVENTION.md).
- **When the CLI changes, the wrapper skill changes in the same commit.** `scripts/lint-skills.sh` (wired into `npm run lint`) enforces this by cross-checking every flag and subcommand a wrapper SKILL.md mentions against the actual `pan <verb> --help` output. Drift fails CI.

See [docs/SKILLS-CONVENTION.md](docs/SKILLS-CONVENTION.md) for the full rules, shapes (CLI-wrapper / CLI-sub-wrapper / Workflow / Reference / Topical), and creating-a-new-skill checklist.

## Planning Modes

`pan start <id>` is the single paved-road entry point: it takes an issue from whatever state it is in to running work.

- **No plan exists** → `pan start` auto-plans (non-interactive), materializes tasks, and starts the work agent when planning finalizes.
- **Plan exists** → `pan start` spawns the work agent from the existing xBRIEF and tasks.
- **Already running** → `pan start` exits 0 with a no-op message and guidance on messaging/attaching the agent.

Planning depth is one optional dial:

```bash
pan start PAN-1071                    # default: config planning.default_mode, or auto if unset
pan start PAN-1071 --plan interactive # Q&A planning session first, then work on approval
pan start PAN-1071 --plan auto        # non-interactive planning, then work (same as default)
pan start PAN-1071 --plan skip        # synthesize a minimal xBRIEF and tasks, then work
```

`planning.default_mode` in `~/.overdeck/config.yaml` sets the default for unplanned issues:

```yaml
planning:
  default_mode: auto   # interactive | auto | skip; unset = auto
```

`pan plan <id>` remains the plan-ONLY verb for producing or refreshing the PRD and xBRIEF without starting work.

The legacy aliases below are deprecated but still functional through the deprecation window:

- `pan start <id> --auto` is an alias for `pan start <id> --plan skip`.
- `pan plan <id> --auto-start` is deprecated; use `pan start <id>` to plan and start work in one command.

**Always verify available flags with `pan <verb> --help`** — the CLI is self-documenting and flags may change between versions.

## Flywheel Order Books

Operator-curated Flywheel campaigns live as order books on `overdeck-state`. Read [`docs/ORDER-BOOKS.md`](docs/ORDER-BOOKS.md) before changing order-book storage, dispatch eligibility, lane semantics, lifecycle, or continuation; all reads and writes must use the orders resolver and writer doors.

## Project Structure

- **Stack**: TypeScript, Node.js 22+, React dashboard, SQLite, Effect.js
- **Build**: `npm run build` (tsdown for CLI/server/contracts, Vite for frontend)
- **Dev**: `npm run dev` (tsx watch)
- **Dashboard**: Must use Node 22 (built dist) — `nohup /home/eltmon/.config/nvm/versions/node/v22.22.0/bin/node dist/dashboard/server.js`
  - **NEVER use `bun run src/dashboard/server/main.ts`** — two reasons:
    1. **node-pty** (`@lydell/node-pty`) is a native Node addon. Under Bun's addon compat layer the PTY spawns but exits with code 0 immediately, breaking `/ws/terminal` for all workspaces.
    2. **Circular ESM deps** — the dashboard source has circular imports that Bun tolerates but Node.js strict ESM rejects, so tsx/source-mode also fails under Node.
  - `pan up` handles this automatically — it runs `dist/dashboard/server.js` under Node 22. Run `npm run build` first if the dist is stale.
  - See [docs/OVERDECK_DEV_SOP.md](docs/OVERDECK_DEV_SOP.md) for startup, mode switching, restart guarantees, and failure triage.
- **Issue tracking**: GitHub Issues (PAN-XXX prefix), NOT Linear
- **Package manager**: Bun (bun.lock, `bun install`, `bun add`)
- **Workspaces**: Bun workspaces — `packages/contracts`, `packages/effect-acp`, `packages/moonshine-linux-x64`, `packages/qwen-tts-linux-x64`, `packages/pi-extension`, `packages/ohmypi-extension`, `src/dashboard/server`, `src/dashboard/frontend`, `apps/desktop`
- **Build configs**: tsdown.config.ts at the root (CLI), `src/dashboard/server/`, `packages/contracts/`, `packages/pi-extension/`, `packages/ohmypi-extension/`, `apps/desktop/`, and `sync-sources/hooks/` (hook bundle via `build:scripts`)

## Workspace Setup for Agents

Workspaces are git worktrees at `workspaces/feature-<issue-id>/`. Each worktree has its
own `node_modules` created by `bun install` — **never symlink node_modules from the main repo**.
Symlinks break local workspace package resolution (e.g., `@overdeck/contracts` would
resolve to the main repo's stale build instead of the worktree's version).

See [docs/WORKSPACE-CONTAINERS.md](docs/WORKSPACE-CONTAINERS.md) for the workspace
container contract, stack-health surfaces, spawn gate, and recovery commands.

**Before running builds or tests in a workspace:**
1. Run `bun install` from the workspace root (creates correct workspace-aware node_modules)
2. If you modified `packages/contracts/`, rebuild: `cd packages/contracts && npm run build`
3. Build commands use the root `node_modules/.bin/` — run from workspace root, not subdirectories

**NEVER symlink node_modules** — `bun install` uses hardlinks from the global cache and is
nearly instant (~2s). It correctly resolves `@overdeck/contracts` to the worktree's local
`packages/contracts/` via Bun workspace resolution.

**Quality gates** (must pass before `pan done`):
- `npm run typecheck` — TypeScript strict mode (root, hooks, evals, both dashboard halves — server and frontend each guarded by a shrink-only ratchet: `scripts/lint-dashboard-types.sh`, `scripts/lint-frontend-types.sh` — and `typecheck:acp` for `packages/effect-acp`)
- `npm run lint` — ESLint plus `lint:effect-diagnostics`; see [docs/EFFECT-DIAGNOSTICS.md](docs/EFFECT-DIAGNOSTICS.md)
- `npm test` — Vitest (root + frontend)

## tmux Socket — CRITICAL

**Overdeck agents run under a separate tmux socket named `overdeck`.** Always use `-L overdeck` when inspecting agent sessions:

```bash
# List all agent sessions
tmux -L overdeck list-sessions

# Attach or capture a specific agent
tmux -L overdeck capture-pane -t agent-min-846 -p -S -50
tmux -L overdeck attach -t agent-min-846
```

The default tmux socket (`/tmp/tmux-1000/default`) is NOT used by agents. Plain `tmux list-sessions` will show "no server running" or list unrelated sessions. This is a common source of false "agent not found" errors.

## PTY supervisor for orchestrator delivery

Claude Code work agents and Claude Code conversation sessions use the PTY
supervisor as the preferred orchestrator-to-agent delivery path. The launcher
wraps Claude as `node <projectRoot>/dist/pty-supervisor.js claude ...`, exports
`OVERDECK_AGENT_ID`, and writes a per-agent `pty-token` under
`${OVERDECK_HOME}/agents/<id>/pty-token` before the tmux session starts.

The supervisor is Node 22-only because it owns a real PTY through
`@lydell/node-pty`; do not run it under Bun. It binds
`${OVERDECK_HOME}/sockets/pty-<id>.sock` at mode `0600`, accepts authenticated
HTTP-on-unix POSTs, writes each delivered message into Claude's PTY input, and
echoes the message into the tmux transcript so operators can see what was sent.
`src/lib/channels/injection-budget.ts` is the single timing source for the
supervisor's payload-sized echo, settle, and purge waits and for the delivery
client deadline that must outlast them. The supervisor accepts at most 262,144
characters, returns HTTP 400 above that limit, and can therefore purge every
character it accepted before retrying without stacking duplicate composer text.

`deliverAgentMessage(agentId, message, caller?)` is the single delivery
primitive. In automatic mode it tries, in order (two earlier tiers — codex app-server
and ACP sockets — precede these but are no-ops for Claude Code agents):

1. PTY supervisor socket (`path: "supervisor"`)
2. legacy Claude Code Channels MCP socket for already-wired sessions
3. tmux paste-buffer fallback

The tmux fallback presses Enter after an unverified paste so text never sits
orphaned in the composer — except when the pane is blocked on a numbered choice
menu (session-resume gate, permission prompt, plan approval). That menu is why
the paste was swallowed, and Enter would confirm its highlighted row, so
`sendKeys` fails the delivery with `MessageDeliveryFailed` instead. Never answer
a menu Overdeck did not open: at the resume gate the highlighted row is "Resume
from summary", and a stray Enter there discarded an operator's full session
(PAN-3212). `paneHasBlockingChoiceMenu()` in `src/lib/pane-choice-menu.ts` is
the shared detector. The keyed dedup submit applies the same guard before its
server-owned `if-shell` Enter. Each pending claim has an explicit, strictly-read payload state:
`unverified` requires text in the cursor-anchored active composer (positive absence atomically
re-pastes), while `enter-attempted` preserves no-repaste rollback recovery. Unreadable, unset legacy,
or unknown states remain pending and fail closed rather than authorizing Enter.

Summary forks add a pane-verified recovery above that transport: when the
runtime transcript stays silent but the delivered tail remains in the composer,
the fork pipeline sends at most two standalone Enter keystrokes. If submission
still cannot be confirmed, it keeps the conversation alive but records
`forkStatus = 'failed'` with an actionable `forkError` instead of presenting an
empty transcript as a healthy completed fork.

Docker workspaces remain excluded from supervisor wiring until host/container
socket sharing is designed; Pi keeps using its `rpc.in` FIFO. H1 lifecycle
semantics apply: the supervisor owns Claude's PTY master fd, so if the
supervisor process exits, Claude exits with it and the session must be resumed
through the normal dashboard/Deacon flow.

## Claude Code Channels (experimental legacy fallback)

Reference: https://code.claude.com/docs/en/channels

Claude Code Channels is now a legacy fallback — see the PTY supervisor section
above for the recommended transport. Channels remains only for already-running
agents with `state.channelsEnabled = true` and for explicit diagnostic opt-in
via `experimental.claudeCodeChannelsMcp: true`.

`src/lib/channels/overdeck-bridge.ts` is a per-agent Bun stdio MCP server.
When the diagnostic override is enabled, Claude is spawned with
`--mcp-config <workspace>/.pan/agent-mcp.json --dangerously-load-development-channels server:overdeck-bridge`,
the bridge listens on `${OVERDECK_HOME}/sockets/agent-<id>.sock`, and
`deliverAgentMessage` uses it only after the supervisor tier fails. The
`WARNING: Loading development channels` dialog is dismissed only when that MCP
config is actually wired; supervisor-only sessions must not receive this Enter
keystroke.

## Pipeline membership — the canonical resolver

Pipeline membership is the durable exception queue defined in
[`docs/PIPELINE-MEMBERSHIP.md`](docs/PIPELINE-MEMBERSHIP.md). Every surface must
delegate to `resolvePipelineMembership()` in `src/lib/pipeline-membership.ts` or
its API/DTO projection; no surface may independently derive membership from
tracker state, workspaces, agents, tmux, or review-status rows.

## Decisions — the canonical operator-decision surface

Everything that shows the operator a pending decision reads
`src/dashboard/frontend/src/lib/useDecisions.ts` (`useDecisions()` for the
Decisions list, `usePendingInputSubjects()` as the drop-in for consumers of
`selectPendingInputSubjects`). It is the only place that joins the two domains a
decision can arrive from: **agents**, which reach the store through the event
pipeline into `agentsById`, and **conversations**, which are not rows in the
agents table and arrive over REST from `/api/conversations/pending-input`.

Never read `selectPendingInputSubjects` directly in a new surface — it sees
agents alone, so a question from a conversation or the flywheel would be visible
in one place and missing from another. That was the PAN-2765 defect.

See [docs/ASKUSERQUESTION-DASHBOARD.md](docs/ASKUSERQUESTION-DASHBOARD.md) for
the full pipeline, the `agentTurnEnded` kind, and why a transcript must be
resolved by the agent's own session id rather than "newest file in the dir".

## Dashboard Server Architecture (Effect + Raw WebSocket)

The dashboard server uses **Effect.js** for HTTP routes and structured RPC, plus a
**raw WebSocket** endpoint for terminal streaming.

**Server structure** (split from old 15K-line monolith in PAN-428):
- `src/dashboard/server/main.ts` — entry point, dual-runtime (Bun dev, Node prod)
- `src/dashboard/server/server.ts` — Effect HTTP server, route composition, layers
- `src/dashboard/server/ws-rpc.ts` — Effect RPC over WebSocket at `/ws/rpc`
- `src/dashboard/server/ws-terminal.ts` — raw WebSocket terminal at `/ws/terminal`
- `src/dashboard/server/routes/` — ~60 route modules plus domain subdirs (agents/, misc/, resources/, specialists/, workspaces/)
- `src/dashboard/server/services/*.ts` — domain services (cache, agent enrichment, TTS runtime/playback, etc.)
- `src/dashboard/server/event-store.ts`, `read-model.ts` — event store and in-memory read model, at the server root

**Two WebSocket endpoints:**
- `/ws/rpc` — Effect RPC (PanRpcGroup): domain events, snapshots, replay. Uses typed Schema.
- `/ws/terminal?session=<name>` — Raw WebSocket: live PTY terminal streaming via `ws` library.
  Terminal data bypasses Effect RPC because the RPC serialization layer can't handle
  high-throughput binary-like terminal data reliably.

**Terminal architecture** (`ws-terminal.ts` + `XTerminal.tsx`):
- Server: raw `WebSocketServer` with `noServer: true`, deferred PTY spawn (waits for
  client resize dimensions), `node-pty` spawns `tmux attach-session`
- Client: raw `WebSocket` API with a five-minute patient reconnect window from
  `terminalReconnectPolicy.ts`: delays are 1s, 2s, 4s, then a flat 5s.
- Reconnect state stays outside xterm scrollback in a status overlay; exhaustion keeps
  the terminal mounted and offers a manual Reconnect action.
- Close code `4404` means the tmux session is still gone after the server-side wait and
  is fatal. Close code `4503` means the dashboard is gracefully restarting, so the UI
  shows calm "Dashboard restarting" copy and uses the same patient reconnect policy;
  `handleShutdownSignal` broadcasts `4503` before server teardown.
- PTY waits for the tmux session to exist (`sessionExists` + respawn-pending waits) before spawning
- Attach uses a deterministic snapshot protocol: the server sends a `snapshot` control frame,
  the client acks `ready`, and only then does live data flow (`readyForLiveData` in XTerminal.tsx);
  unready clients are closed with `terminal-ready-timeout`

**Frontend data flow:**
- `EventRouter.tsx` → connects to `/ws/rpc`, fetches snapshot via `getSnapshot` RPC,
  subscribes to `subscribeDomainEvents` stream, applies events to Zustand store
- `wsTransport.ts` — Effect-based RPC client with auto-reconnection
- Store: Zustand with shared reducers from `@overdeck/contracts`

**Issue views:** Rail, cockpit, and console issue surfaces share the kit documented in
`docs/ISSUE-VIEW.md`. Route new issue sections through `IssueViewModel`, the shared
components, and `DENSITY_SECTIONS`; update the inventory and real `data-section`
marker so the no-loss gate proves that no existing surface disappeared.

**God View:** `/god-view` centers the Confluence production canvas from [PAN-3447](https://github.com/eltmon/overdeck/issues/3447); its deliberate style-guide exemption and live-data contract are documented in `docs/GOD-VIEW.md`.

**Session lifecycle rules:**
- On WebSocket close, do NOT kill the PTY — the tmux session survives independently.
- Do NOT pre-resize tmux windows. Let the PTY spawn handle sizing via client dimensions.
- The planning launcher script MUST export TERM/COLORTERM/LANG for Claude Code rendering.
- Planning sessions use `remain-on-exit on` + `destroy-unattached off` so the session
  survives after the agent exits, until the user clicks Done.

## Effect bridging

When a callee returns an Effect, yield it directly; reserve `Effect.promise` and
`Effect.tryPromise` for Promise-returning thunks. See
[docs/EFFECT-BRIDGING.md](docs/EFFECT-BRIDGING.md) for error handling and valid bridges.

## Verification Gate (PAN-174)

After a work agent signals completion, Cloister runs quality gates from `projects.yaml`
before advancing to the review role. If typecheck/lint/test fail, feedback is sent to the
agent's tmux session and the issue does not advance, so the agent can fix and retry.
After 3 consecutive failures, verification is bypassed to prevent permanent blocking.

## Verdict feedback routing

Review `blocked`/`failed`, test `failed`, and UAT `failed` verdicts all return work to
the work agent through the same feedback doors: `writeFeedbackFile()` persists the
feedback, `resolveIssueFeedbackTarget()` finds or resurrects the work target, and
`surfaceIssueFeedbackNeedsYou()` creates a durable escalation when no target resolves.
The UAT relay is `src/lib/cloister/uat-failure-feedback.ts`.

## Review Convergence Gate (PAN-3151)

When a change enters the `blocked` review state, the blocking-finding count is recorded into a `reviewCycleHistory` series. When ≥3 cycles are recorded and the series shows a reversal (latest count > previous) or stall (two consecutive non-decreases), the issue is marked `stuck` with `stuckReason: 'review-not-converging'`. Automatic rework re-drive is suppressed; feedback file is written and PR comment posted, but the work agent is not messaged. A needs-you escalation surfaces with the cycle count series and guidance to decompose the change into sibling issues or run `pan unstick <issueId>` to clear the gate and attempt rework. Distinguish from the prompt-level convergence gate (`roles/review.md` — "Convergence gate (cycle ≥ 3)", currently around line 148), which governs single-reviewer filtering within one cycle.

## Agent Auto-Resume Gates

Deacon auto-resume is intentionally suppressible through the unified
`getAgentResumeGateBlockReason` classifier and `decideResumeGate` intent policy:

- **Boot no-resume:** `OVERDECK_NO_RESUME=1`, `pan dev --no-resume`, or
  `pan up --no-resume` disables orphan recovery and stopped-agent auto-resume for
  that dashboard boot only. Restart without `--no-resume` to restore patrols.
- **Manual pause:** `pan pause <id> [--reason <text>]` persists `paused` fields in
  `~/.overdeck/agents/<agent-id>/state.json` and stops the agent if it is running.
  `pan unpause <id>` clears the gate without spawning. `pan start <id>` refuses
  paused agents unless `--force` is passed; `--force` clears the pause gate first.
- **Troubled gate:** repeated resume/crash failures mark an agent `troubled` and
  preserve failure counters/backoff state in `state.json`. `pan untroubled <id>`
  clears the troubled gate and failure fields after the underlying crash cause has
  been investigated. It does not spawn the agent.
- **Operator-stop gate:** `stoppedByUser` blocks autonomous re-drive when no
  completed handoff exists and emits one durable needs-you trip. A completed
  handoff that owes review/test/verification rework may clear the historical
  flag and re-drive. Explicit operator start clears only `stoppedByUser`; it does
  not silently clear paused or troubled state.
  Only an operator-initiated stop may set the flag (PAN-3324). `stopAgent`,
  `stopAgentSync`, and `markAgentStoppedState` take an `AgentStopCause` that
  defaults to `'system'`; `'operator'` is passed by `pan kill`, `pan pause`, the
  dashboard stop/pause actions, and the flywheel stop/pause/abort commands, and
  nowhere else. Every machinery-initiated stop — memory shedding, health
  force-kills, stalled-review-parent reaping, close-out, reconciling a process
  the OOM killer already took — leaves the flag unset so autonomous recovery
  stays eligible. Recording an OOM kill as an operator stop is what turned a
  transient resource event into a permanent stall.
- **Memory gate (PAN-2500):** `assessMemoryPressure()` in `src/lib/cloister/memory-governor.ts`
  gates every autonomous resume/dispatch path — boot recovery, patrol auto-resume,
  reactive resume-on-stop, and review/test/ship dispatch — on live memory pressure,
  not just agent count and CPU load. Below the SOFT reserve it defers new admissions;
  below HARD it sheds (stops merged/closed docker stacks, then pauses idle work
  agents); it never re-admits until memory clears RECOVERY. See
  [`docs/RESOURCE-GOVERNOR.md`](docs/RESOURCE-GOVERNOR.md) for the full model. This
  is separate from `--no-resume`, which suppresses resume outright regardless of memory.

Separately, the **preemptive scheduler** (PAN-2507, opt-in via `[concurrency]
preemption = true`) may **yield** an idle work agent — pause it to free capacity
for a blocked review/test/merge dispatch. A yield reuses the same `paused: true`
gate (so all four suppression gates above protect it), tagged with
`yieldedByScheduler`/`yieldedAt`. Unlike an operator pause it is **self-clearing**:
`autoResumeStoppedWorkAgents` resumes yielded agents oldest-first, ahead of any
other stopped candidate, once a slot and the memory gate allow — and `pan
unpause` on a yielded agent clears the yield attribution too. See
[`docs/RESOURCE-GOVERNOR.md`](docs/RESOURCE-GOVERNOR.md) → "Preemptive scheduling".

These gates are orthogonal to the global Deacon freeze in SQLite
(`deacon.globally_paused`) and the per-issue Deacon ignore flag in review status.

## Agent State Planes (PAN-1908)

Agent and pipeline state is split into three planes. Do not read or write the wrong one.

1. **Permanent plane — git infra repo.** Durable per-issue records under `.pan/records/<issue>.json` (the `records` subdir is a fixed literal; `pan_records.path` configures the `.pan` base dir) containing the continue subset (`decisions`, `hazards`, `feedback`), the `pipeline` verdict block, `closeOut` (usage, merges, ranOn), and the `owner` URI lease. Specs and project-side continues live here too. Portable across machines.
2. **Runtime plane — local SQLite `~/.overdeck/overdeck.db`.** The `agents` table is the authoritative runtime registry; `review_status` holds ephemeral columns; `events` is the lifecycle event log. Rebuildable from git + tmux.
3. **Liveness oracle — tmux on socket `-L overdeck`.** Ground truth for whether an agent process is actually running.

Key rules:
- Enumerate agents from the `agents` table, not from `~/.overdeck/agents/*/state.json`.
- `state.json` is kept as a rollback/rebuild source only.
- Durable `review_status` verdicts are mirrored into the per-issue permanent record's `pipeline` block.
- Configure the infra repo per project in `projects.yaml` under `pan_records: { repo, path }`.
- `pan admin db rebuild-agents` reconstructs the `agents` table from `state.json` + live tmux.
- `pan admin db backfill-records` writes permanent records for all in-flight issues.
- `OVERDECK_NO_RESUME=1` disables event-driven deacon resume/orphan recovery as a kill switch.

Agent-dir deletion goes through `removeAgentStateDir()`, which removes runtime
residue while preserving every `**/*.jsonl` transcript in place. Transcripts
are retained forever by default; only an explicit positive
`retention.transcript_days` enables the ended-agent transcript sweep. Terminal
registry rows remain in `phase: retained-transcripts` while JSONLs need their
agent-to-issue link; a `.retained-transcripts` marker prevents repeated generic
GC reads and walks. Automatic
cleanup continues to skip `conv-*` dirs entirely.

See [`docs/AGENT-STATE-PLANES.md`](docs/AGENT-STATE-PLANES.md) for the full model.

## Workspaces & Projects (PAN-1990)

The `projects`/`workspaces`/`project_targets`/`pinned_docs` tables are a
first-class domain in the runtime plane above: one row per registered project
and one row per git worktree Overdeck knows about (`kind`: `main` — exactly
one per project — `issue`, or `scratch`). Reads go through
`src/lib/workspaces/resolver.ts`, writes through
`src/lib/workspaces/writer.ts` — no other module may touch these tables
directly, except `src/lib/overdeck/infra.ts` which owns their DDL
(`scripts/guard-workspace-doors.sh` enforces this in `npm run lint`).
`pan admin db rebuild-workspaces` reconstructs them from `projects.yaml`, a
worktree scan, and memory-home identity records, the same disposable-cache
pattern `rebuild-agents` uses for the `agents` table; it also **archives, never
deletes**, issue rows whose issue reached a terminal stage. Full model,
cardinalities, and the polyrepo wrapper-repo git posture: [`docs/WORKSPACES-AND-PROJECTS.md`](docs/WORKSPACES-AND-PROJECTS.md).

Workspaces are also created and managed **from the dashboard** (PAN-3330), not
just the CLI. `src/lib/workspaces/create.ts` holds the shared core —
`resolveWorkspaceCreateIntent()` (read-only resolution + validation, returning
`findings` instead of throwing, and never reading an ambient cwd) and
`performWorkspaceCreate()` (worktree, seeding, row) — and both `pan workspace
new`/`main` and the routes call it, so the New Workspace dialog's live
resolve-before-create preview cannot disagree with what confirming does. The
routes are `POST /api/workspace-registry/resolve` (write-free dry run), `POST
/api/workspace-registry` (422 with findings, else 201 `{id}`), `POST
/api/workspace-registry/:id/relocate`, and `GET
/api/workspace-registry/project-targets`. Entry points: the sidebar WORKSPACES
`+`, a command-palette action, and a per-project button; `WorkspaceView` adds
Favorite/Relocate/Archive for non-issue kinds.

A workspace **targets** a repo directory, and several may target the same one:
`pan workspace new <name> --target-path <dir>` points at any existing directory
(rejects `--isolated`), `--dry-run` prints the resolved intent as JSON and
creates nothing, and `pan workspace relocate <ref> --path <dir>` re-points an
existing workspace (refuses `kind=issue`; `kind=main` needs `--force`). Because
memory homes are keyed by workspace UUID, relocating never moves memory on disk.

The sidebar rail and Cmd-K `workspaces` scope list only main/scratch/favorited
rows, collapsing the rest into an expandable "N pipeline worktrees" count row —
presentation only, the API still returns every kind. Main/scratch rows badge the
memory-synthesized phase from the list DTO's `memoryPhase`; issue rows keep the
pipeline phase.

The workspace view's **quick-action band** (PAN-3331) adds five routes on the
same registry surface: `GET /:id/git` (ahead/behind against the branch's own
`@{u}`, not `origin/HEAD`; `?fetch=1` really fetches, throttled to once per 30 s
per path), `POST /:id/pull` (`git pull --ff-only`, typed refusals for dirty /
in-flight operation / diverged / no-upstream / detached — `kind=issue` is
refused with 409 and keeps using `sync-main`), `PUT /:id/run-command` and
`POST /:id/run` (per-workspace `run_command` column — never `layout_config`,
which the panels library rewrites — defaulting to the project's first
`services[].start_command`, spawned as one `ws-run-<sha256-prefix>` tmux session per
workspace — the suffix is a 16-hex hash of the workspace id, not the id itself), and `POST /:id/open` (file manager always; editor only when
`ui.open_in_editor_command` is set in `~/.overdeck/config.yaml`). Git logic
lives in `src/lib/workspaces/git-state.ts`. The detail and git reads are
`rejectUnauthorizedDashboardRequest`-guarded — the first returns executable
command text, the second reaches the network — and the unauthenticated list DTO
omits `runCommand` entirely.

**Memory is keyed by workspace UUID, not issue id**: observations, pending
turns, status, and summaries live under
`~/.overdeck/memory/{projectId}/{workspaceId}/…`. A conversation with no
spawned agent (a main/scratch workspace turn) still gets a full
`MemoryIdentity` — `issueId` is nullable and `agentRole` accepts
`'conversation'` precisely so a non-issue turn has somewhere to attribute its
observations. `pan memory search --global` and `pan memory pin/unpin/pins`
read/write through the same two doors; `pan memory backfill` retroactively
extracts observations from historical Claude Code JSONL transcripts, matching
each session's cwd to a workspace via `resolveWorkspaceForCwd()`.

Recall is workspace-addressable, not issue-only:

- `pan memory search --target [path]` — every workspace targeting a directory.
- `pan memory status --workspace <id|name>` and `pan memory status --history <n>` — current status and its archive.
- `pan memory summary --workspace <id|name>` — same addressing as `status`.
- `pan memory timeline` — observations in chronological order.
- `pan memory read <path>` — a file from the workspace's memory home, containment-checked so `~/.claude` JSONL is unreachable.

`status`/`summary` fall back to the cwd's workspace when given neither a
positional nor `--workspace`. SessionStart additionally injects a
local-files-only standing briefing, once per session id.

## Project Resolution from Issue IDs

Issue IDs are resolved to projects via `resolveProjectFromIssue()` in `src/lib/projects.ts`
and `parseGitHubRepos()` in `src/lib/tracker-utils.ts`. Resolution order:

1. Match the `issue_prefix` field (or any entry in the `issue_prefixes` array) in
   `projects.yaml` (e.g., `issue_prefix: MIN` matches `MIN-123`). `issue_prefix` was
   renamed from the legacy `linear_team`, which is no longer read.
2. For projects with neither field, derive the prefix from the project key
   (e.g., project key `krux` → prefix `KRUX` matches `KRUX-3`)

When adding a new project to `projects.yaml`, either set `issue_prefix` explicitly or
ensure the project key (uppercased, hyphens removed) matches the issue prefix you want.

## Task Enforcement

Work agents require a readable, implementation-ready xBRIEF. The start-agent endpoint returns 422
when the plan is missing, unreadable, belongs to another issue, or contains no implementation items.
Planning writes the xBRIEF checklist directly; it does not materialize an external task store.

Completion and verification are also gated by the xBRIEF checklist. `runVerificationForIssue()` in
`src/lib/cloister/verification-runner.ts` calls `checkIncompletePlanItemsPromise()` and reports
`failedCheck: 'incomplete-plan-items'` while any item or sub-item is not terminal. Agents update that
checklist through `pan task`; there is no separate tracker to reconcile at merge or close-out.
## Post-merge lifecycle Idempotency (enforced by a test, not by this note)

The post-merge lifecycle must run **at most once per merge**. ("postMergeLifecycle" survives
only as a legacy label — `src/core/state-mapping.ts` — the merge agent owns the behavior.)
If it can re-trigger itself, you get an infinite loop — that once burned 24,626 tracker API
calls (PAN-328). The original loop was:
specialists/done → onMergeComplete → post-merge lifecycle → (re-trigger) → specialists/done.

This protection is now **structural, not advisory** — you don't have to remember
a rule:

- The concurrency guard is `createInFlightGuard()` in
  `src/lib/cloister/in-flight-guard.ts`, used by `firePostMergeLifecycle` in
  `src/dashboard/server/routes/specialists/shared.ts` (re-exported from
  `specialists.ts`). A second *concurrent* call for the same issue is a no-op.
- It is locked by `tests/unit/lib/cloister/in-flight-guard.test.ts`. **Weaken or
  delete the guard and that suite goes red** — that is the real protection.
- The lifecycle also checks `mergeStatus` / `_completedPostMerge`
  (defense-in-depth).

So the rule is just: if you touch the merge-completion path, keep that test
green. A red guard test means you've reopened the loop. Adding new work to the
post-merge path (e.g. a rolling re-rebase fan-out) is fine as long as it stays
idempotent and the test stays green.

A merge to `main` can make another open branch stale. When the merge-train flag
(`flywheel.merge_train_enabled`, default off) is ON, `runMergeTrainReconcile()` runs
inside the post-merge guard and rebases/re-verifies ready siblings (PAN-1691); with the
flag off, nothing acts on stale siblings automatically — reconcile an affected workspace
explicitly with `pan sync-main <id>` before it proceeds through review or merge.

## Post-merge Verify Handoff and Docker Cleanup

The merge agent's post-merge handoff (`src/lib/cloister/merge-agent.ts`; the old
`postMergeLifecycle()` function no longer exists) is non-destructive. After
merge it marks the issue `verifying_on_main`, applies the `verifying-on-main` label,
pauses the work/planning agents, preserves workspace/state/xBRIEF/branches, and removes
the workspace Docker containers and `overdeck-feature-<issue>_devnet` network.

Docker cleanup still happens at merge time because orphaned networks from merged
workspaces accumulate and eventually block new workspace creation with "all predefined
address pools have been fully subnetted". Docker's default pool only supports ~31 bridge
networks. NEVER remove this cleanup step.

The durable, verified teardown owner is **close-out**: `pan close <id>` / dashboard
Close Out stops and removes the workspace Docker stack (including the
`overdeck-feature-<issue>_devnet` network) and verifies the network is gone. The deacon's
reaper is the backstop: it runs full `reapIssueResidue` cleanup for tracker-closed issues
and queues Docker-only teardown for merged-but-not-closed issues on a deduplicated serial
worker with retry backoff. Tracker-backed devnet closure checks run in batches of four. The worker revalidates canonical merged status before each
attempt, while a fresh merge-agent enqueue may use its just-verified merge for the first
retry if status persistence lags. Durable `mergeStep: post-merge-cleanup` marks an incomplete
handoff. Startup atomically claims the pending file and runs it in a supervised background
promise, so dashboard boot continues while the claim remains owned. Failure moves the claim to
a discoverable queued generation unless canonical status positively owns the retry; a newer
pending generation is never overwritten or discarded. Startup and patrol reclaim queued files
and claims whose owner PID is dead. Issue IDs are validated at the route and lock boundaries,
and the resolved lock path must remain inside the lifecycle lock directory. Completion records
`mergeStep: merged`. Patrol reconciliation prunes Docker retries that are
no longer eligible. The worker removes Compose
volumes, project-owned containers, and the leaked devnet while preserving workspace files,
branches, agents, sessions, state, and xBRIEF. The single `rebuildWorkspaceStack`
chokepoint no-ops for closed and merged issues, so patrols never recreate a terminal stack.

The destructive/non-reversible completion steps are owned by close-out, not merge:
`pan close <id>` / dashboard Close Out completes the xBRIEF, archives planning artifacts,
optionally tears down the workspace or deletes feature branches according to `close_out`
config, closes the tracker issue, and clears review status.

## CRITICAL: Deep-Wipe Destroys Everything — NEVER Run Without Explicit User Confirmation

The deep-wipe endpoint (`POST /api/issues/:id/deep-wipe`) with `deleteWorkspace: true` is **irreversible** and destroys:

1. **tmux sessions** — all agent sessions killed
2. **Agent state directories** — `~/.overdeck/agents/<id>/` removed
3. **Entire workspace directory** — this includes:
   - `.overdeck/spec.vbrief.json` — the **workspace-specific xBRIEF plan**
   - `.beads/` — all task tracking tasks
   - Any implementation work in progress
4. **Git branches** — both local AND remote `feature/<issue-id>` branches deleted
5. **Linear/GitHub status** — issue status reset to Todo/Open

**The scope xBRIEF** in `specs/` on `overdeck-state` survives deep-wipe — it's committed to the project repo independently of the workspace. Project-level PRD archives also survive; the Overdeck-managed PRD at `drafts/<issue>.md` on `overdeck-state` survives too (on disk: `${OVERDECK_HOME}/state/<project>/drafts/<issue>.md`). The workspace `.overdeck/` runtime directory and `.beads/` redirect are disposable.

**Rules:**
- **NEVER call deep-wipe programmatically** without the user explicitly requesting it
- **NEVER attempt destructive HTTP requests** (POST, DELETE) speculatively — HTTP requests execute immediately when sent; tool rejection by the user CANNOT stop an already-sent request
- When a user wants to restart an agent, use the regular stop/restart flow, NOT deep-wipe
- Deep-wipe is a last resort for cleaning up abandoned workspaces, not a routine operation

## TLDR: Token-Efficient Code Analysis

TLDR is wired in as a PreToolUse hook on `Read`, not as MCP tools: reading a
large code file automatically returns a structured summary (~1k tokens instead
of 10-25k) whenever the file's own checkout has `.venv/bin/tldr`. You don't
need to invoke anything. To see full contents anyway, Read with offset/limit;
recently-edited files always return full content so you can verify your changes.

For deliberate exploration, use the CLI via Bash from the checkout root:
`.venv/bin/tldr context <module-path> --lang <lang>` for structure/exports, or
`.venv/bin/tldr extract <file>` for structured JSON. Do NOT call `tldr_*` MCP
tools (`tldr_context`, `tldr_semantic`, ...) — they are not registered in agent
sessions and will not exist in your toolset (PAN-3534).


## Bash Output Compression (RTK)

When `agents.rtk.enabled` is true, Bash outputs the agent sees (git status, npm output, etc.) may be compressed by RTK. Re-run with `OVERDECK_RTK_ENABLED=0` to regenerate raw command output.

## xBRIEF Plans & Lifecycle

Overdeck emits **xBRIEF v0.8** for machine-readable work plans (readers accept v0.5–v0.8; see `docs/XBRIEF.md`). Key references:

- **Canonical spec:** [github.com/deftai/xBRIEF](https://github.com/deftai/xBRIEF) (renamed from vBRIEF at v0.7.0; spec now v0.8)
- **Our fork:** [github.com/eltmon/xBRIEF](https://github.com/eltmon/xBRIEF)
- **Extension proposal:** [deftai/xBRIEF#40](https://github.com/deftai/xBRIEF/issues/40) (supersedes #1)
- **Overdeck docs:** [docs/XBRIEF.md](docs/XBRIEF.md) — full schema, lifecycle, and migration notes

### The four-artifact model (PAN-1124: single-spec-on-main)

There are four artifacts. They are distinct — do not conflate them.

| Artifact | Location | Writer | Mutability |
| --- | --- | --- | --- |
| **PRD draft** (`.md`) | `drafts/<issue>.md` on `overdeck-state` (disk: `${OVERDECK_HOME}/state/<project>/drafts/<issue>.md`); planning agents author it workspace-side at `.pan/drafts/<ISSUE>.md` and complete-planning promotes it to `overdeck-state` | Human or planning agent | Free-form narrative, human-mutable |
| **xBRIEF spec** (`.json`) | `specs/<YYYY-MM-DD>-<ISSUE>-<slug>.xbrief.json` on `overdeck-state` (disk: `${OVERDECK_HOME}/state/<project>/specs/<file>`) | Pipeline only (single writer) | Immutable after planning — only `plan.status` changes via `updateSpecStatus()` |
| **Project-side continue state / per-issue record** (`.json`) | `${OVERDECK_HOME}/state/<project>/continues/<issue-lowercase>.xbrief.json` | Pipeline | Session resume point, decisions, hazards, sessionHistory, feedback, and the `statusOverrides` map tracking item/subItem completion — one canonical file per issue, never moves |
| **Workspace-side continue state** (`.json`) | `<workspace>/.overdeck/continue.json` | Pipeline + work agent | Session state; legacy `statusOverrides` are read once as a one-way backfill into the project-side record (from the `.pan/continue.json` path) |

**The PAN-1124 invariant — the canonical spec is immutable after planning.** `findPlan()` resolves the canonical spec on `overdeck-state` via `findSpecByIssue()`. `readWorkspacePlan()` returns a merged view: canonical spec + `statusOverrides` from the project-side per-issue record (`readIssueRecord()`). `updateItemStatus()` and `updateSubItemStatus()` (in `src/lib/xbrief/io.ts`) write ONLY to that record's `statusOverrides` map via `writeStatusOverrideSync()` — they cannot mutate the spec. The only legal spec mutation is `plan.status` via `updateSpecStatus()` in `pan-dir/specs.ts`. This replaces the old PAN-946 invariant (workspace-spec isolation) with a stronger guarantee: there is no workspace spec to isolate.

**Gitignore policy.** `.overdeck/continue.json` is listed in `.gitignore` and must NEVER be tracked in main. `.overdeck/spec.vbrief.json` may still exist in older workspaces (migration compat) but is no longer written by the pipeline. The lifecycle artifacts (`specs/`, `continues/`, `drafts/`) remain tracked — they're the canonical record of plans, continue states, and PRD drafts at rest.

### Status is a JSON field, not a directory

`plan.status` advances through one canonical file via state-door commits on `overdeck-state`. Files do not move between directories.

```
draft (in `drafts/*.md` on `overdeck-state`) ──► proposed ──► active/running ──► completed
                                       │                              │
                                       └──────────► cancelled ◄───────┘
```

(`PanSpecStatus` is `proposed | active | completed | cancelled`; an incoming legacy
`approved` is mapped down to `proposed` on read.)

| Transition | Trigger | What changes |
| --- | --- | --- |
| (new) → draft | `pan plan` starts | Markdown PRD written to `drafts/<issue>.md` |
| draft → proposed | Planning completes | xBRIEF created in `specs/...` with `plan.status: "proposed"` |
| proposed → active/running | `pan start` | Status field flipped on `overdeck-state` (`transitionXBriefOnMain(..., 'active', 'running')`); work agent reads spec from main via `findPlan()` |
| running → completed | PR merges | Status field flipped to `"completed"` on main |
| any → cancelled | Issue closed | Status field flipped to `"cancelled"` on main |

### Legacy paths

PAN-967 unified everything under `.pan/`. The following are gone or read-only legacy:

- `.planning/plan.vbrief.json` — **DELETED.** PAN-967 replaced it with `.pan/spec.vbrief.json`; PAN-1124 later retired new workspace copies. PAN-2541 uses `.overdeck/spec.vbrief.json` only as the renamed workspace-runtime compatibility path. The current canonical spec is `specs/<file>` on `overdeck-state`.
- `docs/prds/planned/` — no longer a Overdeck convention for *planning*: canonical PRD drafts live in `drafts/` on `overdeck-state`. But `docs/prds/active|completed/` IS still an active archival surface: lifecycle resets copy the workspace PRD to `docs/prds/active/<issue>` (`src/lib/lifecycle/workflows.ts`), and close-out moves it `active/` → `completed/` (`src/lib/close-out.ts`, paths in `src/lib/prd-locations.ts`).
- `vbrief/{proposed,active,completed,cancelled}/` at the project root — still read by `findLegacyXBriefByIssue` for backward compatibility during migration; pipeline writes target `specs/` only. Legacy spec files (non-continue) remain at these paths as read-only fallback.

If you see an agent referencing `.planning/`, `docs/prds/planned/*.xbrief.json`, or planning a "copy PRD xBRIEF into workspace .planning" step, the agent is reading a pre-PAN-967 problem statement and needs to be redirected at `docs/XBRIEF.md`.

### Auto-Behaviors

- `src/lib/xbrief/io.ts` (`updateItemStatus`/`updateSubItemStatus`) write to the project-side per-issue record's `statusOverrides` map (`writeStatusOverrideSync`) — they do NOT mutate the spec.
- `readWorkspacePlan()` returns a merged view: canonical spec + `statusOverrides` overlay from the project-side record.
- `complete-planning` writes the xBRIEF to `specs/...` with `plan.status: "proposed"`.
- `start-agent` flips the main-side status field. Work agents read the spec from main via `findPlan()`.
- The merge agent's post-merge handoff marks merged work as `verifying_on_main` and preserves the xBRIEF in its running/active state.
- `closeOut` flips the main-side `plan.status` to `"completed"` after post-merge verification, and runs verified Docker stack + `_devnet` network teardown (with the closed-issue reaper as a backstop).
- `findPlan(workspacePath)` resolves `specs/<file>` on `overdeck-state` via `findSpecByIssue(projectRoot, issueId)`, with fallback to workspace-local `.overdeck/spec.vbrief.json` for migration compatibility.

### Dashboard Viewer

XBriefViewer components at `src/dashboard/frontend/src/components/xbrief/`:
- The kanban issue-card xBRIEF button opens `XBriefDialog` (its only importer is `KanbanBoard.tsx`; the old InspectorPanel is gone).
- The project-tree xBRIEF chip and the drawer/cockpit expand controls open the globally mounted `XBriefFullscreen` List / DAG / Raw viewer.
- The issue-row tasks chip opens the xBRIEF-backed `TasksPanel`; the PRD chip opens the canonical draft through `PrdViewer` and `ChatMarkdown`.
- Plan viewers fetch from `GET /api/workspaces/:issueId/plan` (resolves from `specs/` on `overdeck-state` via `findSpecByIssue`, with workspace fallback for migration compat).

## Issue Creation from PRDs

When creating a Linear or GitHub issue from a PRD, **always reference the PRD at the very top of the issue description** -- before any other content. Use a bold label with a repo-relative path and a clickable link:

```
**PRD:** [`path/to/prd.md`](https link to the file in the repo)
```

For a migrated project, link the canonical PRD as
`blob/overdeck-state/drafts/<issue>.md`; the legacy `.pan/drafts/` link is only
for projects without a valid migration completion marker.

The issue body should then contain a tight summary (vision, motivation, design goals, key capabilities, phases) -- NOT a full copy of the PRD. The PRD is the source of truth for data models, architecture, code samples, and implementation details. Duplicating that content into the issue creates drift.
