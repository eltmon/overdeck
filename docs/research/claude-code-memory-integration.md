# Claude Code Memory: Control, Integration & Hook Points

Research date: 2026-07-19. Evidence: official docs (code.claude.com/docs), plus direct reverse-engineering of the installed binary (Claude Code v2.1.209) and live-session observation on this machine.

## The two memory systems

1. **CLAUDE.md hierarchy** — human-authored instructions: managed policy → `~/.claude/CLAUDE.md` → project `CLAUDE.md`/`.claude/CLAUDE.md` → `CLAUDE.local.md`, plus `.claude/rules/*.md` and `@path` imports (max 4 hops). Docs: https://code.claude.com/docs/en/memory.md
2. **Auto-memory** — Claude-authored persistent memory at `~/.claude/projects/<project-slug>/memory/`: `MEMORY.md` index (first ~200 lines / 25KB loaded into every session's context) + one-fact-per-file markdown with frontmatter (`name`, `description`, `metadata.type: user|feedback|project|reference`). Individual files are read on demand, not preloaded.

## Control surface (verified in binary v2.1.209)

### Settings keys (any settings tier, incl. managed policy)
- `autoMemoryEnabled: boolean` — "Enable auto-memory for this project. When false, Claude will not read from or write to the auto-memory directory." Default true.
- `autoMemoryDirectory: string` — "Custom directory path for auto-memory storage. Supports ~/ prefix." Resolution order: policySettings → flagSettings → (localSettings → projectSettings, only when workspace is trusted) → userSettings.

### Environment variables
| Var | Effect |
| --- | --- |
| `CLAUDE_CODE_DISABLE_AUTO_MEMORY` | truthy → memory off entirely (read+write) |
| `CLAUDE_CODE_REMOTE_MEMORY_DIR` | relocate the whole memory root (remote/sandbox sessions) |
| `CLAUDE_COWORK_MEMORY_PATH_OVERRIDE` | host override of memory path (Cowork embedding surface) |
| `CLAUDE_COWORK_MEMORY_GUIDELINES` | **replaces** the entire built-in "# auto memory" prompt |
| `CLAUDE_COWORK_MEMORY_EXTRA_GUIDELINES` | **appends** to the memory prompt |
| `CLAUDE_COWORK_MEMORY_INDEX_CONTENT` | host-supplied index content |
| `CLAUDE_MEMORY_STORES` | JSON array of team/user memory mounts (`mount`, `path`, `scope: user\|team`, `mode: rw\|ro`) — team memory / memory-service subsystem, feature-flag gated |
| `CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC` | stop the periodic re-scan of the memory dir |
| `CLAUDE_CODE_DISABLE_MEMORY_BULK_INFLATE` | disable bulk store sync (`backend.exportAll`) |
| `CLAUDE_CODE_FORCE_EVALUATE_MEMORY` | force the background memory-evaluation pass |
| `CLAUDE_CODE_FORCE_MEMORY_SURVEY` | force the memory feedback survey UI |

Caveat: the `CLAUDE_COWORK_*`, `CLAUDE_MEMORY_STORES`, and resync/inflate vars are **undocumented internals**, partially gated behind server-side flags (`tengu_*` GrowthBook keys). `autoMemoryEnabled` / `autoMemoryDirectory` / `CLAUDE_CODE_DISABLE_AUTO_MEMORY` are the documented, stable knobs.

### Commands
- `/memory` — browse/edit all memory files; UI toggle writes `autoMemoryEnabled` to userSettings (telemetry `tengu_auto_memory_toggled`).

## How memories get written — the two write paths

1. **Main-loop writes**: the session's system prompt instructs Claude to write memory files **with the ordinary Write/Edit tools**. These are normal tool calls in the normal pipeline.
2. **Background memory evaluator**: a restricted side-agent (prompt found in binary: "If nothing is worth saving, output only 'Nothing to save.'"; tools limited to Read/Glob/Grep, read-only Bash, and Edit/Write **for paths inside the memory directory only** — "All other tools — MCP, Agent, write-capable Bash, etc — will be denied"; limited turn budget). `CLAUDE_CODE_FORCE_EVALUATE_MEMORY` forces it. It also writes via constrained file tools.

## Hooking in

- **No dedicated memory hook events exist.** Full hook event list in v2.1.209 (verified in binary): SessionStart, Setup, SessionEnd, UserPromptSubmit, Stop, StopFailure, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, SubagentStart, SubagentStop, TeammateIdle, TaskCompleted, PreCompact, PostCompact, Notification, FileChanged, ConfigChange, etc. No PreMemoryWrite/PostMemoryWrite.
- **De-facto pre-memory-write hook**: because main-loop memory writes are plain `Write`/`Edit` tool calls, a `PreToolUse` hook with matcher `Write|Edit|MultiEdit` receives `tool_input.file_path`; the hook script checks whether the path is under the memory dir (`~/.claude/projects/*/memory/` or the configured `autoMemoryDirectory`) and can **deny** (`permissionDecision: "deny"` with a reason fed back to the model), allow, or log. `PostToolUse` on the same matcher = post-memory-write (mirror/audit/index).
  - Unverified edge: whether the background memory evaluator's writes also flow through user PreToolUse hooks. Its writes use the same tool infrastructure, so likely yes, but this was not empirically confirmed.
- **Blunt block**: permission deny rules on Write/Edit for the memory path also work.
- **External writes are first-class**: the memory dir is watched. External modifications inject a `memory_update` system reminder into *running* sessions: "<source> updated your memory directory: <summary> / Files changed: … / Your loaded copy of <file> is now stale relative to disk." Periodic resync interval is server-controlled (`tengu_memory_store_resync_interval_minutes`), disable via `CLAUDE_CODE_DISABLE_MEMORY_PERIODIC_RESYNC`. An orchestrator can therefore write/edit/delete memory files between or during sessions and Claude picks the changes up.
- **SessionStart hook `additionalContext`** — inject your own memory-like context per session (independent of auto-memory).

## Related subsystems

- **Subagent memory**: custom agents (`.claude/agents/*.md`) accept a `memory` scope; storage: user → `~/.claude/agent-memory/<name>`, project → `<project>/.claude/agent-memory/<name>` (version-controlled, team-shared), local → `~/.claude/agent-memory-local/<project-slug>/<name>`. Prompt guidance per scope confirmed in binary.
- **Team memory / memory stores**: `CLAUDE_MEMORY_STORES` mounts appear as `team/<mount>/` with their own index; ro/rw modes; sync watcher (`.memory-sync`, github-remote detection), "memory-service"-fetched indexes wrapped as `<memory path="…">` reference data. Experimental / flag-gated.
- **Agent SDK**: no built-in auto-memory; loads CLAUDE.md via `settingSources`; roll your own via hooks or the separate **API memory tool** (`memory_20250818`, Messages API — client-side `/memories` file ops you execute yourself).
- **Compaction/clear**: memory files are on disk and survive /compact and /clear; the index is re-injected on session start.

## Overdeck integration levers (ranked)

1. **Redirect the store**: set `autoMemoryDirectory` per project (settings) or `CLAUDE_CODE_REMOTE_MEMORY_DIR` in the spawn env to route each agent's memory into Overdeck-managed state (e.g. a dir inside `${OVERDECK_HOME}/state/<project>/`), making memory durable, git-synced, and inspectable through the state plane.
2. **Pre/post-write gating**: PreToolUse/PostToolUse hooks on Write|Edit filtered by memory path = veto/normalize/mirror memory writes (e.g. enforce Overdeck's memory taxonomy, dedupe against OKF, block secrets).
3. **Push memories in**: write files into the memory dir externally; running sessions get `memory_update` reminders, next sessions load the updated index. Update `MEMORY.md` index lines yourself when adding files.
4. **Replace the policy**: `CLAUDE_COWORK_MEMORY_GUIDELINES` / `_EXTRA_GUIDELINES` to swap or extend the memory-writing instructions per agent role (undocumented; pin versions).
5. **Kill it where unwanted**: `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` in pipeline-agent spawn envs where per-project auto-memory would pollute (e.g. short-lived strike/review agents), keeping it for conversations/flywheel.

## Sources
- https://code.claude.com/docs/en/memory.md
- https://code.claude.com/docs/en/hooks.md
- https://code.claude.com/docs/en/settings.md
- https://code.claude.com/docs/en/sub-agents.md
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool.md
- Binary string analysis: `@anthropic-ai/claude-code` v2.1.209 (`bin/claude.exe`), this machine.
