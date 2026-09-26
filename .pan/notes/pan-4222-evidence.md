# PAN-4222 evidence — before/after Agents Live view screenshots

Playwright screenshots on branch `evidence/pan-4222` (orphan, PNGs only, never
merged). Both sides drove the same live production dashboard data
(`127.0.0.1:3011`) through a Vite dev server proxying `/api` and `/ws` — every
non-GET `/api` request was intercepted and aborted except the app's own
read-only session bootstrap (`POST /api/dashboard/session`, issues a CSRF
token, no dashboard-state write), so the production dashboard received no
writes. "Before" ran from a throwaway worktree checked out at `origin/main`;
"after" ran from this branch. `git worktree add --orphan` created the
evidence branch from a throwaway worktree under `.tmp/`; the workspace itself
was never checked out anywhere but `feature/pan-4222`.

## Default list

| | Light, 1600×1000 | Light, 1280×900 | Dark, 1600×1000 | Dark, 1280×900 |
| --- | --- | --- | --- | --- |
| Before (main) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/before-light-1600.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/before-light-1280.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/before-dark-1600.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/before-dark-1280.png?raw=true) |
| After (this branch) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-light-1600.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-light-1280.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-dark-1600.png?raw=true) | [link](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-dark-1280.png?raw=true) |

The "before" shots show the pre-existing bugs directly: a row reading `1h
quiet 1h` (the age printed twice), and rows labeled `running Bash`. "After"
shows the bare tool name and, where the hook has one, its description on the
line below.

## Empty state

- Before: [dark, 1600×1000](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/before-empty-dark-1600.png?raw=true) — the list's empty message renders beside a still-mounted preview pane showing "Select an agent to see its transcript.", the two-messages bug.
- After: [dark, 1600×1000](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-empty-dark-1600.png?raw=true) — a single column, one message, no preview pane.

## Live row tool description (ac2)

**P0 path used:** `window.useDashboardStore.setState` — the store is exposed
on `window` unconditionally by `src/dashboard/frontend/src/lib/store.ts`
(debug/test hook), so the capture script injected an
`agent.activity_changed`-shaped runtime snapshot (`currentTool: 'Bash'`,
`currentToolDescription: 'Commit WI-7'`) for this issue's own live Herdr work
agent (`agent-pan-4222`) and screenshotted immediately after, in the same
script, before the agent's next real tool call could overwrite it (the hook
that adds `toolDescription` is not deployed to this host until `pan sync` runs
post-merge, so every real event until then lacks the field — that overwrite
race is real, not hypothetical).

- [Full page, dark, 1600×1000](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-tool-description-dark-1600.png?raw=true)
- [Row crop](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-tool-description-row-crop.png?raw=true) — reads `Bash · Commit WI-7 · just now`

The end-to-end path (a real hook emitting `toolDescription`) is only
observable on this host after merge + `pan reload` + `pan sync`; this work
agent's own session runs the hook shipped before this PR, so it cannot
demonstrate that leg itself. WI-1/WI-2/WI-4's unit and component tests cover
the hook → event → reducer → row path directly.

## Conversation preview rail collapse (ac3)

[Dark, 1280×900](https://github.com/eltmon/overdeck/blob/evidence/pan-4222/screenshots/after-conversation-subagents-dark-1280.png?raw=true) —
a live conversation with subagents (`conv:20260924-2873`) selected in the Live
preview at 1280px: the transcript renders beside the collapsed 30px "AGENTS"
rail tab, not the full 256px rail that used to squeeze the transcript to
~70px.

## Non-write guarantee (ac4)

The capture script (`.tmp/pan-4222-evidence/capture.mjs`, gitignored, not
committed) intercepts every `**/api/**` request and aborts any non-GET method
except the one read-only session-bootstrap POST described above. Across both
capture runs it aborted 17 non-GET `/api` requests total (5 before, 12 after)
— confirmed via the script's own counter, logged to
`.tmp/pan-4222-evidence/result.json` (also gitignored).
