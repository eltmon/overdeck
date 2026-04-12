# PAN-473: Workspace detail — structured conversation view for stopped agents

## Status: Implementation Complete

## Current Phase
All beads complete. Quality gates pass (typecheck, lint, tests — pre-existing shadow-state failure unrelated to this issue).

## Completed Work
- [x] feature-pan-489-u2q: Added GET /api/agents/:id/conversation endpoint to agents.ts (commit: efc84f39)
- [x] feature-pan-489-jzn: Updated TerminalPanel.tsx to fetch conversation for stopped agents and render MessagesTimeline when messages exist

## Remaining Work
(none)

## Key Decisions
- Force `streaming: false` in conversation endpoint response — tmux session is dead, stale streaming state would show a live cursor on archival content
- Return empty shape (HTTP 200) when JSONL file doesn't exist — clean fallback signal for frontend
- No styles module needed for MessagesTimeline container — it handles its own scrolling internally
- `refetch` helper in TerminalPanel invalidates both output and conversation queries

## Specialist Feedback
- (none yet)
