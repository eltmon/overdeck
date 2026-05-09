# Panopticon CLI — Graph Summary

**8830 nodes · 20525 edges · 404 communities**
Stack: TypeScript, Node.js 22, React, SQLite, Effect.js

## God Nodes (most cross-cutting symbols)
- `specialists` — 257 connections (`lib_work_types_test_specialists`)
- `ConversationEvent` — 232 connections (`src_rpc_conversationevent`)
- `execAsync` — 224 connections (`lib_dns_execasync`)
- `KanbanBoard()` — 134 connections (`components_kanbanboard_kanbanboard`)
- `fetch` — 132 connections (`tests_terminalpanel_test_fetch`)
- `config` — 120 connections (`cli_index_config`)
- `Command Deck` — 94 connections (`readme_command_deck`)
- `result` — 91 connections (`lib_cost_test_result`)
- `resolveProjectFromIssue()` — 89 connections (`lib_projects_resolveprojectfromissue`)
- `getDatabase()` — 86 connections (`database_index_getdatabase`)

## Top 20 Communities by Size
- **Agent Session Lifecycle Management** (155 nodes)
- **Merge Agent Post-Merge Lifecycle** (112 nodes)
- **Command Deck Overview Tab UI** (108 nodes)
- **Deacon Patrol and Queue** (104 nodes)
- **VBrief Plan Builder and Viewer** (94 nodes)
- **Agent Runtime Spawning** (93 nodes)
- **Parallel Review Pipeline Dispatch** (92 nodes)
- **Specialist Handoff and Planning Spawn** (91 nodes)
- **Workspace Creation and Worktree** (82 nodes)
- **Conversation Database and Favorites** (80 nodes)
- **Cloister Service Health and Config** (76 nodes)
- **Inspector Panel Terminal UI** (76 nodes)
- **Agent Snapshot and Event Types** (76 nodes)
- **Event Store Domain Services** (75 nodes)
- **Kanban Board Agent Status UI** (74 nodes)
- **Electron Desktop App and Tray** (71 nodes)
- **Health Metrics and Settings Pages** (69 nodes)
- **Issue Service and Data Fetching** (66 nodes)
- **Workspace Lifecycle and Config** (63 nodes)
- **Git Activity and Runtime Metrics** (60 nodes)

## Key Architectural Layers
- **CLI** `src/cli/` — pan commands, user-facing entry points
- **Cloister** `src/lib/cloister/` — specialist orchestration: review → test → merge pipeline
- **Agents** `src/lib/agents.ts` — spawn, message, kill tmux sessions
- **Dashboard server** `src/dashboard/server/` — Effect HTTP + raw WebSocket (Node 22 only)
- **Dashboard frontend** `src/dashboard/frontend/` — React + Zustand
- **vBRIEF** `src/lib/vbrief/` — plan lifecycle: proposed → active → completed
- **Contracts** `packages/contracts/` — shared RPC types between server and frontend

## How to Navigate
- Cross-module questions: `graphify query "<question>"` (BFS traversal, no file reads needed)
- Trace a connection: `graphify path "A" "B"`
- Understand a symbol: `graphify explain "<name>"`
- Full community map: graphify-out/GRAPH_REPORT.md (large — only read specific sections)
- Visual graph: graphify-out/graph.html