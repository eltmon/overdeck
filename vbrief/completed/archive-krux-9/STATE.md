# STATE: KRUX-9 — Rearchitect: Remote-Control Claude CLI as AI Backbone

## Status: Planning Complete

## Decisions

### 1. Transcript Flow: Push + Pull
Orchestrator pushes accumulated transcript as user messages when Claude is idle (primary path). The `get_transcript` MCP tool remains available for Claude to re-read older context during analysis. Both patterns coexist.

### 2. Context Handling: Hybrid (Manifest + --add-dir)
The system prompt includes a compact file manifest (paths, types, sizes) generated from the context loader. Claude gets direct file access via `--add-dir contextDir` and can Read/Glob/Grep files natively. The context-formatter is simplified to produce a manifest instead of full file content. The context loader UI still shows which files exist and lets users toggle/reorder them.

### 3. Tool Access: --allowedTools Whitelist
Use `--allowedTools` to explicitly whitelist: `Read`, `Grep`, `Glob`, and MCP tools (`mcp__krux__get_transcript`, `mcp__krux__report_insights`, `mcp__krux__report_summary`). `--disallowedTools Edit,Write,Bash` keeps Claude read-only.

### 4. Model Selector: Sonnet / Opus / Haiku
Three model options in the UI dropdown:
- **Haiku** — ultra-fast, low-latency for simple meetings
- **Sonnet** — balanced, default for real-time monitoring (default)
- **Opus** — deep analysis for complex topics or post-meeting review

Maps directly to `--model haiku`, `--model sonnet`, `--model opus`.

### 5. MCP Transport: Streamable HTTP
Use `@modelcontextprotocol/sdk` with streamable HTTP transport. Start an HTTP server on a random port, write the URL to a temp `mcp-config.json`. Claude connects via `--mcp-config`. Clean separation between processes, no port conflicts.

### 6. API Keys UI: Deepgram Only + CLI Status
Remove Anthropic and Kimi key fields from the UI. Claude CLI handles its own auth (user runs `claude login` separately). Only Deepgram STT key is managed by Krux. Add a Claude CLI status indicator showing if `claude` binary is detected and authenticated.

### 7. CLI Detection: On Session Start
Check for `claude` binary when user clicks Start. Show clear error with install instructions if missing. No startup-time check.

### 8. Auto-Analyze: Continuous Mode Toggle
Replace the timer-based auto-analyze with a single "Continuous Analysis" toggle:
- **ON**: Transcript is pushed to Claude automatically as it arrives (when Claude is idle). Default when session starts.
- **OFF**: User clicks "Analyze" manually to trigger analysis.
No interval selector needed.

### 9. Model Switching: Restart with --resume
On model change mid-session: kill current claude process, respawn with `--resume <session-id>` and new `--model` flag. Claude keeps full conversation history.

### 10. Session Persistence: Enabled
Claude sessions are persisted so `--resume` works for model switching.

### 11. Insight Flow: Individual MCP Calls
Claude calls `report_insights` once per insight as it discovers them. Each call pushes a single insight to the UI immediately via IPC. This replaces the current batch model where all insights arrive at once.

## Out of Scope
- Export format changes (same markdown/JSON output)
- UI layout redesign (same Allotment panels and pane structure)
- Deepgram STT changes (unchanged)
- Insight state persistence (pin/dismiss unchanged)

## Architecture Overview

```
Renderer (React)
  ├── useAIAnalysis hook (updated for new events)
  ├── AnalysisControls (continuous toggle, sonnet/opus/haiku selector)
  ├── ApiKeyManager (deepgram only + Claude CLI status)
  └── App.tsx (updated props)
      │
      │ IPC (electron)
      ▼
Main Process (Orchestrator)
  ├── ClaudeProcess (claude-process.ts)
  │     ├── spawn('claude', [...flags])
  │     ├── stdin: write NDJSON user messages
  │     ├── stdout: parse NDJSON responses
  │     ├── idle detection → trigger transcript push
  │     └── session resume on model switch
  │
  ├── KruxMCPServer (krux-mcp.ts)
  │     ├── HTTP server on random port
  │     ├── get_transcript → returns buffered entries
  │     ├── report_insights → pushes single insight to renderer
  │     └── report_summary → pushes summary to renderer
  │
  ├── Context manifest generation (simplified context-formatter)
  │     └── produces file list for system prompt
  │
  ├── DeepgramService (unchanged)
  │     └── onTranscript → buffer → push on Claude idle
  │
  └── system-prompt.md (appended via --append-system-prompt)
```

## File Impact Analysis

### New Files (3)
- `src/main/claude-process.ts` — child process manager (NDJSON, idle loop, resume)
- `src/main/krux-mcp.ts` — local MCP server (streamable HTTP, 3 tools)
- `src/main/system-prompt.md` — appended system prompt with manifest template

### Files to Delete (6)
- `src/main/providers/anthropic.ts`
- `src/main/providers/moonshot.ts`
- `src/main/providers/normalize.ts`
- `src/main/providers/types.ts`
- `src/main/ai-service.ts`
- `src/main/prompts.ts`

### Files to Modify (10)
- `src/shared/types.ts` — update AIModel (haiku/sonnet/opus), ApiKeyProvider (deepgram only), StreamEvent, new ClaudeStatus type
- `src/main/index.ts` — replace AI wiring with ClaudeProcess + MCP, simplify API key IPC, add CLI detection
- `src/main/api-key-manager.ts` — remove anthropic/kimi support
- `src/main/context-formatter.ts` — simplify to produce file manifest instead of full content
- `src/preload/index.ts` — update AI and apikey APIs, add claude status events
- `src/renderer/hooks/useAIAnalysis.ts` — rewrite for new event model (continuous toggle, insight-at-a-time)
- `src/renderer/components/AnalysisControls.tsx` — continuous toggle, new model selector
- `src/renderer/components/ApiKeyManager.tsx` — deepgram only + Claude CLI status
- `src/renderer/App.tsx` — remove hasActiveProvider gate, update props
- `package.json` — remove @anthropic-ai/sdk, openai; add @modelcontextprotocol/sdk

### Tests to Update/Delete/Create (~10 files)
- Delete: `providers.test.ts`, `ai-service.test.ts`, `normalize.test.ts`
- Create: `claude-process.test.ts`, `krux-mcp.test.ts`
- Update: `useAIAnalysis.test.tsx`, `AnalysisControls.test.tsx`, `ApiKeyManager.test.tsx`, `api-key-manager.test.ts`, `context-formatter.test.ts`

## Task Breakdown

### Phase 1: Foundation (no cross-dependencies)
1. **Update shared types** [simple] — Update AIModel, ApiKeyProvider, StreamEvent, add ClaudeStatus
2. **Create system prompt** [simple] — Write system-prompt.md with Krux behavior + manifest template
3. **Update dependencies** [trivial] — Remove @anthropic-ai/sdk, openai; add @modelcontextprotocol/sdk

### Phase 2: Core Backend (depends on Phase 1)
4. **Create MCP server** [complex] — krux-mcp.ts with streamable HTTP, 3 tools, random port
5. **Create Claude process manager** [expert] — claude-process.ts with NDJSON, idle detection, transcript push, resume
6. **Simplify context-formatter** [simple] — Produce file manifest instead of full content

### Phase 3: Wiring (depends on Phase 2)
7. **Update main process** [complex] — Rewrite index.ts: ClaudeProcess + MCP wiring, CLI detection, simplified API key IPC, transcript feed loop
8. **Remove old provider code** [simple] — Delete providers/, ai-service.ts, prompts.ts

### Phase 4: Frontend (depends on Phase 3)
9. **Update preload bridge** [medium] — Update AI and apikey IPC APIs, add claude status events
10. **Update renderer hooks + components** [medium] — useAIAnalysis rewrite, AnalysisControls (continuous toggle + model selector), ApiKeyManager (deepgram + CLI status), App.tsx

### Phase 5: Verification
11. **Update tests** [complex] — Delete old tests, create new (claude-process, MCP), update modified
