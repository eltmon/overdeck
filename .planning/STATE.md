# PAN-473: Workspace detail — structured conversation view for stopped agents

## Status: In Progress

## Current Phase
Bead feature-pan-489-u2q closed. Starting bead feature-pan-489-jzn: update TerminalPanel.tsx to render MessagesTimeline for stopped agents.

## Completed Work
- [x] feature-pan-489-u2q: Added GET /api/agents/:id/conversation endpoint to agents.ts, imported parseConversationMessages from conversation-service, registered in agentsRouteLayer

## Remaining Work
- [ ] feature-pan-489-jzn: Update TerminalPanel.tsx to fetch conversation when agent is stopped, render MessagesTimeline if messages exist, fall back to raw output otherwise

## Key Decisions
- Force `streaming: false` in conversation endpoint response — tmux session is dead, stale streaming state would show a live cursor on archival content
- Return empty shape (HTTP 200) when JSONL file doesn't exist — clean fallback signal for frontend without treating it as an error

## Specialist Feedback
- (none yet)
