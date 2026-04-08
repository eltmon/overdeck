<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-486

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
- **ID:** PAN-486
- **Title:** Detachable terminal — popout workspace terminal into OS window
- **URL:** https://github.com/eltmon/panopticon-cli/issues/486

## Description
## Summary

Add a **popout** button to each workspace terminal panel that opens the terminal in a dedicated, OS-managed window. The user gets full window management — drag, resize, snap, Alt+Tab, taskbar entry — while the underlying tmux session is unchanged.

## Motivation

The terminal is the primary interaction surface for Panopticon agents. Users often want to:
- Monitor a running agent while working in another workspace
- Give a terminal more screen real estate without resizing the whole dashboard
- Have the terminal appear as a separate taskbar entry for Alt+Tab switching

## Desktop Framework Decision: Electron ✅

Panopticon will use **Electron** (not Electrobun) for its desktop app (PAN-442). Key reasons affecting this feature:

- **node-pty is a native Node addon** — Bun doesn't support native addons, so Electrobun would require a separate Node child process just for PTY management
- **Electron bundles Node** — no runtime split, node-pty and better-sqlite3 work natively
- **Chromium renderer** — consistent behavior for xterm.js across all platforms (Electrobun uses platform native WebViews which vary)

The Phase 2 implementation below is written for Electron.

## Implementation Plan

### Phase 1 — Browser (`window.open`)
- Add a detach/popout icon button to the terminal panel header
- `window.open('/workspace/:id/terminal/standalone', 'terminal-:id', 'popup,width=1000,height=700')`
- Since terminals are already ttyd sessions with persistent URLs, no reconnection needed — same tmux session, second viewport
- Window naming prevents duplicate popouts — re-focuses existing popup on second click
- Set `document.title` in the popup to `"PAN-XXX · <workspace title>"` for identification

### Phase 2 — Electron (`BrowserWindow`)
- Same button triggers `ipcRenderer.send('open-terminal-window', { workspaceId, title })`
- Main process creates a native `BrowserWindow` — no browser chrome, custom title bar, Panopticon icon in taskbar
- Window title shows workspace name + agent status, updated dynamically via IPC
- Optional: always-on-top toggle

```ts
// Runtime detection
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;

function popoutTerminal(workspaceId: string, title: string) {
  if (isElectron) {
    window.electronAPI.openTerminalWindow({ workspaceId, title });
  } else {
    window.open(
      `/workspace/${workspaceId}/terminal/standalone`,
      `terminal-${workspaceId}`,
      'popup,width=1100,height=700'
    );
  }
}
```

## Acceptance Criteria

- [ ] Detach button visible in terminal panel header
- [ ] Clicking opens a popup/window containing only the terminal (no dashboard chrome)
- [ ] Popped-out terminal connects to the same tmux session (no new session spawned)
- [ ] Window title reflects workspace name
- [ ] Closing the popup does not kill the terminal session
- [ ] Re-clicking the button re-focuses the existing popup (no duplicates)
- [ ] Works in both single and multi-workspace views

## Notes

- ttyd sessions already have isolated URL endpoints — this is effectively a second viewport into an existing session
- Depends on PAN-484 (shared PTY + WebSocket multiplexing) being fixed first — without it, a popout triggers the same reconnect loop
- See PRD at `docs/prds/planned/pan-486-detachable-terminal.md`

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
    "description": "Plan for PAN-486: <issue title>"
  },
  "plan": {
    "id": "pan-486",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:minimax-m2.7-highspeed",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/486", "label": "PAN-486", "type": "issue" }
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
          "issueLabel": "pan-486"
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
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-486")
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
