# Mission Control & Shadow Engineering

## Overview

Mission Control is Panopticon's default landing view — a unified monitoring interface for all active projects, features, and AI agent activity. Shadow Engineering is a companion mode for teams adopting AI-assisted development incrementally.

## Mission Control

### Layout

Mission Control uses a two-panel layout:

- **Sidebar (left)**: Resizable project tree showing all configured projects with their active features/workspaces
- **Main panel (right)**: Feature activity view, planning artifacts, and status reviews

### Project Tree

Projects appear as collapsible folders. Each active feature shows:

| Element | Description |
|---------|-------------|
| Status indicator | Spinner if agent is running, circle if idle |
| Issue ID | PAN-123, MIN-456, etc. |
| State label | Idle, Planning, In Progress, In Review, Done, Has Context, Suspended |

State labels are computed from multiple signals: tmux session presence, heartbeat freshness (10-minute threshold), review/test status from the central `review-status.json`, and agent state files.

### Activity View

When you click a feature, the main panel shows all agent sessions unified into one scrollable view. Each session appears as a collapsible section with:

- **Type badge**: PLANNING (blue), WORK (green), REVIEW (amber), TEST (indigo), MERGE (pink)
- **Model**: Which Claude/LLM model the agent used (e.g., Opus 4.6, Sonnet 4.5)
- **Duration**: How long the session ran
- **Status dot**: Green pulse (running), gray (completed), red (failed)
- **Transcript**: Full agent output with tail-anchored auto-scroll for running sessions

**Section Isolation Mode**: Click a section header to view it full-screen. Press `Esc` or use the browser back button to return. The isolated view includes model display and a prominent keyboard hint.

### Badge Bar

Quick-access badges appear below the feature header:

| Badge | What it shows |
|-------|---------------|
| Tasks | Opens beads task panel for the feature |
| STATE | Renders STATE.md from the workspace's `.planning/` directory |
| PRD | Renders PRD.md (grayed out if not generated) |
| Status | AI-generated progress review comparing code against PRD |
| Inference | Shadow Engineering inference document (only for shadow workspaces) |
| Discussions | Synced issue tracker discussions |
| Transcripts | Uploaded meeting transcripts |
| Upload | Attach transcripts or notes to the feature |
| Sync | Pull latest discussions from GitHub/Linear |

### Status Reviews

Click the **Status** badge to generate an AI-powered progress review. The review:

1. Gathers context: PRD, STATE.md, git diff, commit log, file changes, review/test status
2. Sends everything to the configured LLM (set via Settings > Workflow Agents > Planning)
3. Returns a structured analysis: summary, PRD coverage table, risk assessment, and recommendations

If no API key is configured, a static template with raw data is shown as fallback.

## Shadow Engineering

### Concept

Shadow Engineering is for teams that want AI assistance without replacing their existing workflow. Instead of AI *doing* the work, AI *observes, documents, and assists*.

| Standard Mode | Shadow Engineering |
|--------------|-------------------|
| Planning agent creates PRD | Monitoring agent infers plan from artifacts |
| Work agent implements features | Observer watches human PRs and comments |
| AI drives the work | AI shadows the work |
| PRD.md generated | Inference Document produced |

### How It Works

1. **Enable Shadow Mode**: When creating a feature workspace, toggle "Shadow Engineering" on
2. **Monitoring Agent**: Analyzes available artifacts (issue description, tracker comments, meeting transcripts, PR descriptions) and produces an **Inference Document** — the AI's working understanding of what the team is building
3. **Inference Document**: Not a prescriptive PRD but an inferred understanding. Surfaces gaps, ambiguities, and risks. Updates as new artifacts arrive
4. **Observer Agent**: Watches the team's actual development. Comments on PRs with observations and suggestions. Only commits code when explicitly asked

### Value Proposition

> **AI that learns your team before it leads.**

Shadow Engineering lets existing engineers keep working their way while Panopticon's AI observes, documents, and assists. It learns the codebase, patterns, and team approach — so when you're ready to go further, the AI already understands how you build.

**Target audience**: Engineering leaders at organizations that:
- Want to adopt AI-assisted development gradually
- Need to maintain existing workflows during transition
- Want AI oversight and documentation without AI-driven changes
- Are evaluating AI coding tools but need a low-risk entry point

### Shadow Workspaces in the UI

Shadow workspaces are visually distinct in Mission Control:
- Marked with a shadow indicator in the project tree
- Show the **Inference** badge instead of generating PRDs
- Inference modal includes an explanation of what the document represents

## Planning Artifacts

Each feature workspace has a `.planning/` directory:

```
feature-pan-XXX/.planning/
├── PRD.md                    # Product requirements (generated or manual)
├── STATE.md                  # Current progress notes
├── INFERENCE.md              # Shadow Engineering inference document
├── STATUS_REVIEW.md          # Latest AI-generated status review
├── transcripts/              # Uploaded meeting transcripts
├── discussions/              # Synced tracker discussions
└── notes/                    # Ad-hoc notes and documents
```

### Uploading Artifacts

Use the **Upload** badge to attach markdown or text files. Files are categorized as transcripts or notes and stored in the appropriate subdirectory.

### Syncing Discussions

Click **Sync** to pull the latest comments from GitHub Issues or Linear. Discussions are converted to markdown and stored in `.planning/discussions/`.

## Configuration

### Model Selection

The model used for status reviews is configured in **Settings > Workflow Agents > Planning**. Any configured provider (Anthropic, OpenAI, Google, Kimi, Z.AI) can be used.

### Adding Projects

Projects are configured in `~/.panopticon/config.yaml`. Any project with active workspaces appears in Mission Control's project tree.

## Conversations

Mission Control includes a **Conversations** panel for managing Claude Code chat sessions directly through the dashboard.

### Conversation List

The conversation list shows all active and ended sessions:

- **Status indicator**: Green pulse (running), gray (ended)
- **Model badge**: Which model the conversation is using
- **Title**: Auto-generated from the first message, or manually renamed
- **Cost**: Estimated token cost for the session

### Forking Conversations

Click the fork icon on any conversation to create a continuation. The fork dialog offers:

| Option | Description |
|--------|-------------|
| **Plain fork** | Copy raw JSONL history (from last compaction point) without generating a summary |
| **Fast summary** | Use a heuristic local summary instead of calling an LLM |
| **Include thinking** | Include thinking block content in the summary (off by default) |
| **Summary model** | Which model generates the summary (when Fast summary is off) |
| **Launch model** | Which model the new conversation uses |

**Summary fork** (default) distills the conversation into a structured checkpoint and injects it as the first message. **Plain fork** copies the raw history with `--resume`. See [FORKS.md](./FORKS.md) for full details on fork behavior, thinking block handling, and model-switching considerations.
