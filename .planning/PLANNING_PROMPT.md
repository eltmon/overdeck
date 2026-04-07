<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-442

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - Implementation plan at `docs/prds/active/{issue-id}/STATE.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-442
- **Title:** Electron desktop app for Panopticon dashboard
- **URL:** https://github.com/eltmon/panopticon-cli/issues/442

## Description
## Decision: Electron ✅

After evaluating both Electron and Electrobun, **Electron is the chosen path**.

**Why Electron over Electrobun:**
- The dashboard server uses **node-pty** for PTY/terminal management — a native Node addon that Bun doesn't support
- Electron bundles Node natively, so node-pty and better-sqlite3 work without modification
- Electrobun's main process is Bun, which would require a separate Node child process for PTY — two runtimes, added complexity
- Electron's Chromium renderer guarantees pixel-perfect consistency across Linux, macOS, Windows
- Electrobun's native WebView (WebKitGTK on Linux) would require additional testing and may behave differently with xterm.js

Electrobun remains worth watching — if Bun gains native addon support, the calculus changes. But for now, Electron is the right call.

---

## Summary

Wrap the Panopticon dashboard in an Electron shell for a native desktop experience. T3Code does this with `apps/desktop` (Electron 40.6.0) — we should follow the same pattern.

## What This Enables

- **One-click launch** — no terminal, no `pan up`, no browser tab
- **System tray** — dashboard runs in background with tray icon showing agent status
- **Native notifications** — OS-level alerts for INPUT needed, stuck agents, merge ready
- **Auto-start** — launch on login, always monitoring
- **Menu bar** — quick access to common actions (start cloister, emergency stop, etc.)
- **Native popout windows** — detachable terminal (PAN-486) becomes a true `BrowserWindow` with Panopticon icon, no browser chrome

## Architecture (T3Code Reference)

T3Code's `apps/desktop` structure:
- `main.ts` — Electron main process, spawns the server, creates BrowserWindow
- `preload.ts` — bridges native APIs to the renderer
- `tsdown.config.ts` — builds the Electron main process
- Embeds the web app and server — single distributable

## Implementation Plan

1. Create `apps/desktop/` with Electron + the existing React frontend
2. Main process starts the dashboard server (Node.js) as a child process
3. BrowserWindow loads `http://localhost:3011` (or embedded static files)
4. System tray with agent status indicator
5. Package with electron-builder for Linux (primary), macOS, Windows

## Considerations

- The server already runs on Node — Electron bundles Node, so no extra runtime needed
- Native node-pty and better-sqlite3 need to be rebuilt for Electron's Node version (`electron-rebuild`)
- Could use electron-forge or electron-builder for packaging
- T3Code uses tsdown for the Electron main process build — we already have tsdown
- Detachable terminal (PAN-486) upgrades automatically: same button, `BrowserWindow` instead of `window.open()`

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}/STATE.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-442: <issue title>"
  },
  "plan": {
    "id": "pan-442",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/442", "label": "PAN-442", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-442"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-442")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
